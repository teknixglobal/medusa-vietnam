import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IEventBusModuleService, Logger } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentActions,
  PaymentSessionStatus,
  PaymentWebhookEvents,
} from "@medusajs/framework/utils"
import { checkCallback, VNPAY_PROVIDER_ID, webhookPayload } from "../../../../lib/hooks"

/**
 * VNPay IPN: GET /hooks/vnpay/ipn (set it as the IPN URL in the VNPay merchant portal).
 * VNPay expects 200 + {"RspCode","Message"}. It stops on 00/02 and retries 01, 04, 97, 99
 * up to 10 times, 5 minutes apart.
 * A paid IPN is handed to Medusa's own webhook pipeline (payment.webhook_received ->
 * processPaymentWorkflow), which authorizes (querydr), captures and completes the cart
 * even when the customer never comes back.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const reply = (RspCode: string, Message: string) => res.status(200).json({ RspCode, Message })
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  try {
    const { result, info, session } = await checkCallback(req)
    if (info.vnpay_ipn === "bad_checksum") {
      logger.warn("VNPay IPN: bad checksum, ignored")
      return reply("97", "Invalid Checksum")
    }
    const stored = session?.data?.vnpay
    if (!session || !stored || stored.txn_ref !== info.txn_ref) {
      return reply("01", "Order not found")
    }
    if (Number(info.amount) !== stored.amount) {
      logger.error(`VNPay IPN: amount ${info.amount} for ${info.txn_ref}, expected ${stored.amount}`)
      return reply("04", "Invalid amount")
    }
    if (
      session.status === PaymentSessionStatus.AUTHORIZED ||
      session.status === PaymentSessionStatus.CAPTURED
    ) {
      return reply("02", "Order already confirmed")
    }
    if (result.action === PaymentActions.SUCCESSFUL) {
      const eventBus = req.scope.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
      // Same event and delay as Medusa's POST /hooks/payment/:provider, to avoid racing
      // the storefront completing the cart.
      await eventBus.emit(
        {
          name: PaymentWebhookEvents.WebhookReceived,
          data: { provider: VNPAY_PROVIDER_ID, payload: webhookPayload(req) },
        },
        { delay: 5000, attempts: 3 }
      )
    }
    // Failed payments are acknowledged too; the session stays pending.
    return reply("00", "Confirm Success")
  } catch (e) {
    logger.error(`VNPay IPN: ${(e as Error).message}`)
    return reply("99", "Unknown error")
  }
}
