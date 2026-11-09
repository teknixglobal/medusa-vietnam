import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VN_COD_METADATA_KEY } from "@teknixglobal/medusa-vietnam-shipping-core"
import { codAmountForOrder } from "../workflows/plan"
import { setVnCodAmountWorkflow } from "../workflows/set-vn-cod-amount"

/**
 * When an order is placed with a COD payment (pp_cod_*), store the amount the
 * carrier must collect in order.metadata.vn_shipping_cod_amount. The GHN
 * provider reads it when the fulfillment is created.
 */
export default async function vnCodAmountHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "total",
      "metadata",
      "payment_collections.payments.provider_id",
      "payment_collections.payment_sessions.provider_id",
      "payment_collections.payment_sessions.status",
    ],
    filters: { id: event.data.id },
  })
  const order = data[0] as Parameters<typeof codAmountForOrder>[0] & { id: string; metadata?: Record<string, unknown> | null }
  if (!order) {
    return
  }
  const amount = codAmountForOrder(order)
  if (!amount || order.metadata?.[VN_COD_METADATA_KEY] === amount) {
    return
  }
  await setVnCodAmountWorkflow(container).run({ input: { order_id: order.id, amount } })
  logger.info(`Order ${order.id}: COD ${amount} VND recorded for the carrier`)
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
