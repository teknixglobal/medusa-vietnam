import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, PaymentSessionStatus } from "@medusajs/framework/utils"
import { withParams } from "@teknixglobal/teknix-vietnam-core"
import { checkCallback } from "../../../../lib/hooks"
import { recordVnpayCallbackWorkflow } from "../../../../workflows/record-vnpay-callback"

/**
 * VNPay return URL: GET /hooks/vnpay/return
 * VNPay has a single return URL with its own result codes. This route checks the
 * signature and sends the customer to the storefront return URL stored in the
 * session (allow-listed when the session was created) with the usual
 * `provider=vnpay&result=success|error|cancel`. A signed "paid" return is recorded on the
 * session (the provider re-checks the signature); the storefront then completes the cart.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  try {
    const { info, session } = await checkCallback(req)
    const returnUrl = session?.data?.return_url
    if (!returnUrl || session?.data?.vnpay?.txn_ref !== info.txn_ref) {
      res.status(400).send("Invalid VNPay return")
      return
    }
    const result =
      info.vnpay_ipn === "paid" ? "success" : info.response_code === "24" ? "cancel" : "error"
    const open =
      session!.status !== PaymentSessionStatus.AUTHORIZED && session!.status !== PaymentSessionStatus.CAPTURED
    if (info.vnpay_ipn === "paid" && open) {
      // The return query is signed by VNPay too: record it so completing the cart works
      // even when the IPN is late or querydr is unavailable.
      await recordVnpayCallbackWorkflow(req.scope).run({
        input: { session_id: session!.id, query: req.query as Record<string, unknown> },
      })
    }
    res.redirect(303, withParams(returnUrl, { provider: "vnpay", result }))
  } catch (e) {
    logger.error(`VNPay return: ${(e as Error).message}`)
    res.status(400).send("Invalid VNPay return")
  }
}
