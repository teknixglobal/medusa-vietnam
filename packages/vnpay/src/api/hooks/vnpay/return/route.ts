import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { withParams } from "@teknixglobal/medusa-vietnam-core"
import { checkCallback } from "../../../../lib/hooks"

/**
 * VNPay return URL: GET /hooks/vnpay/return
 * VNPay has a single return URL with its own result codes. This route checks the
 * signature and sends the customer to the storefront return URL stored in the
 * session (allow-listed when the session was created) with the usual
 * `provider=vnpay&result=success|error|cancel`. It changes nothing: the storefront
 * completes the cart, and authorizePayment confirms with querydr.
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
    res.redirect(303, withParams(returnUrl, { provider: "vnpay", result }))
  } catch (e) {
    logger.error(`VNPay return: ${(e as Error).message}`)
    res.status(400).send("Invalid VNPay return")
  }
}
