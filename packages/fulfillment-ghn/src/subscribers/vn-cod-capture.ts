import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { Logger, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ghnRuntimeFrom } from "../lib/config"
import { captureVnCodPaymentWorkflow, recordVnCodCaptureWorkflow } from "../workflows/capture-vn-cod"
import { planCodCapture, type CodCaptureFulfillment, type CodCaptureOrder } from "../workflows/plan"

async function load(container: MedusaContainer, fulfillmentId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "provider_id", "data", "delivered_at", "canceled_at"],
    filters: { id: fulfillmentId },
  })
  const fulfillment = fulfillments[0] as CodCaptureFulfillment | undefined
  const orderId = fulfillment?.data?.order_id
  if (!fulfillment || typeof orderId !== "string") {
    return null
  }
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "fulfillments.id",
      "fulfillments.provider_id",
      "fulfillments.data",
      "fulfillments.delivered_at",
      "fulfillments.canceled_at",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.canceled_at",
      "payment_collections.payments.captures.amount",
    ],
    filters: { id: orderId },
  })
  const order = orders[0] as CodCaptureOrder | undefined
  return order ? { fulfillment, order } : null
}

/**
 * Option capture_cod_on_delivery: when GHN reports a delivery (the sync workflow marks
 * the fulfillment delivered), capture the order's COD payment. Blocked or failed
 * captures are recorded in order.metadata.vn_cod_capture and logged for a person.
 */
export default async function vnCodCaptureHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const runtime = ghnRuntimeFrom(container)
  if (!runtime?.options.capture_cod_on_delivery) {
    return
  }
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const loaded = await load(container, event.data.id)
  if (!loaded) {
    return
  }
  const { fulfillment, order } = loaded
  const plan = planCodCapture(fulfillment, order, runtime.provider_id)
  const at = new Date().toISOString()
  if (plan.action === "skip") {
    return
  }
  if (plan.action === "block") {
    logger.warn(`Order ${order.id}: COD not captured automatically: ${plan.reason}`)
    await recordVnCodCaptureWorkflow(container).run({
      input: { order_id: order.id, record: { status: "blocked", reason: plan.reason, fulfillment_id: fulfillment.id, at } },
    })
    return
  }
  try {
    await captureVnCodPaymentWorkflow(container).run({
      input: {
        order_id: order.id,
        payment_id: plan.payment_id,
        amount: plan.amount,
        record: { status: "captured", amount: plan.amount, fulfillment_id: fulfillment.id, at },
      },
    })
    logger.info(`Order ${order.id}: COD ${plan.amount} VND captured after GHN delivery`)
  } catch (error) {
    // Two deliveries of one order can race: the other one may have captured it.
    const again = await load(container, event.data.id)
    if (again && planCodCapture(again.fulfillment, again.order, runtime.provider_id).action === "skip") {
      return
    }
    const reason = (error as Error)?.message ?? String(error)
    logger.error(`Order ${order.id}: COD capture after GHN delivery failed: ${reason}`)
    await recordVnCodCaptureWorkflow(container).run({
      input: { order_id: order.id, record: { status: "failed", reason, fulfillment_id: fulfillment.id, at } },
    })
  }
}

export const config: SubscriberConfig = {
  event: "delivery.created",
}
