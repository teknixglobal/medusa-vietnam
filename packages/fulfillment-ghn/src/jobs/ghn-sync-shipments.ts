import type { MedusaContainer } from "@medusajs/framework"
import type { IFulfillmentModuleService, Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { isFinalStatus, type ShipmentStatus } from "@teknixglobal/medusa-vietnam-shipping-core"
import { ghnRuntimeFrom } from "../lib/config"
import { syncGhnShipmentWorkflow } from "../workflows/sync-ghn-shipment"

const BATCH = 50

/**
 * Safety net for missed or stuck GHN webhooks: every 30 minutes, re-read up to
 * 50 GHN fulfillments that are neither cancelled, delivered nor in a final status.
 */
export default async function ghnSyncShipmentsJob(container: MedusaContainer) {
  const runtime = ghnRuntimeFrom(container)
  if (!runtime) {
    return
  }
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const fulfillmentModule = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  // `null` filters rows where the column IS NULL; the filter type does not declare it.
  const notCancelledOrDelivered = { canceled_at: null, delivered_at: null } as unknown as Record<string, Date>
  const open = await fulfillmentModule.listFulfillments(
    { provider_id: runtime.provider_id, ...notCancelledOrDelivered },
    { select: ["id", "data", "updated_at"], order: { updated_at: "ASC" }, take: BATCH * 4 }
  )
  const pending = open
    .filter((f) => {
      const data = (f.data ?? {}) as Record<string, unknown>
      return typeof data.ghn_order_code === "string" && !isFinalStatus((data.shipment_status as ShipmentStatus) ?? "pending")
    })
    .slice(0, BATCH)
  let failed = 0
  for (const f of pending) {
    try {
      await syncGhnShipmentWorkflow(container).run({
        input: { order_code: String((f.data as Record<string, unknown>).ghn_order_code) },
      })
    } catch (e) {
      failed++
      logger.warn(`GHN sync ${f.id}: ${(e as Error).message}`)
    }
  }
  if (pending.length) {
    logger.info(`GHN sync: ${pending.length - failed}/${pending.length} fulfillments checked`)
  }
}

export const config = {
  name: "ghn-sync-shipments",
  schedule: "*/30 * * * *",
}
