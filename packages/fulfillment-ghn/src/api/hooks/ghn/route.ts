import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isCarrierError, WebhookDeduper, type HeaderBag } from "@teknixglobal/medusa-vietnam-shipping-core"
import { ghnRuntimeFrom } from "../../../lib/config"
import { syncGhnShipmentWorkflow } from "../../../workflows/sync-ghn-shipment"

const deduper = new WebhookDeduper()

function bodyOf(req: MedusaRequest): unknown {
  const body = req.body as unknown
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString("utf8"))
  }
  return typeof body === "string" ? JSON.parse(body) : body
}

/**
 * GHN order status callback: POST /hooks/ghn. Set it in the GHN portal
 * (Webhook configuration > Order) with the custom header from options.webhook_secret.
 * GHN webhooks are not signed: the header is checked, then the status is re-read
 * from GHN before anything changes. 2xx = done; 5xx makes GHN retry (backoff from 30 s).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const runtime = ghnRuntimeFrom(req.scope)
  if (!runtime) {
    return res.status(503).json({ message: "GHN is not configured" })
  }
  let body: unknown
  try {
    body = bodyOf(req)
  } catch {
    return res.status(400).json({ message: "invalid JSON" })
  }
  if (!runtime.adapter.verifyWebhook(req.headers as HeaderBag, body)) {
    logger.warn("GHN webhook: rejected (secret header or ShopID mismatch)")
    return res.status(401).json({ message: "unauthorized" })
  }
  let events
  try {
    events = runtime.adapter.parseWebhook(body)
  } catch (e) {
    return res.status(400).json({ message: (e as Error).message })
  }
  for (const event of events) {
    if (await deduper.seen(event.dedupe_key)) {
      continue
    }
    try {
      const { result } = await syncGhnShipmentWorkflow(req.scope).run({
        input: { order_code: event.carrier_order_code },
      })
      if (result.skip && result.reason !== "no change") {
        logger.info(`GHN webhook ${event.carrier_order_code}: ${result.reason}`)
      }
      if (result.flag) {
        logger.warn(`GHN ${event.carrier_order_code}: ${event.raw_status} needs attention (fulfillment ${result.fulfillment_id})`)
      }
      await deduper.remember(event.dedupe_key)
    } catch (e) {
      const retry = !isCarrierError(e) || e.retryable || e.code === "UNAUTHORIZED"
      logger.error(`GHN webhook ${event.carrier_order_code}: ${(e as Error).message}`)
      if (retry) {
        return res.status(503).json({ message: "retry later" })
      }
    }
  }
  return res.status(200).json({ ok: true })
}
