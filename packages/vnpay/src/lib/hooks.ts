import type { MedusaRequest } from "@medusajs/framework/http"
import type { IPaymentModuleService, PaymentSessionDTO, WebhookActionResult } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { VnpaySessionData, VnpayWebhookData } from "../providers/vnpay/service"

/** Provider registered as `{ resolve: ".../providers/vnpay", id: "vnpay" }`. */
export const VNPAY_PROVIDER_ID = "pp_vnpay_vnpay"

export function webhookPayload(req: MedusaRequest) {
  const search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : ""
  return {
    data: req.query as Record<string, unknown>,
    rawData: Buffer.from(search, "utf8"),
    headers: req.headers as Record<string, unknown>,
  }
}

export type CheckedCallback = {
  result: WebhookActionResult
  info: VnpayWebhookData
  session?: PaymentSessionDTO & { data: VnpaySessionData }
}

/** Verify a VNPay GET callback through the provider, then load its payment session. */
export async function checkCallback(req: MedusaRequest): Promise<CheckedCallback> {
  const payment = req.scope.resolve<IPaymentModuleService>(Modules.PAYMENT)
  const result = await payment.getWebhookActionAndData({
    provider: VNPAY_PROVIDER_ID,
    payload: webhookPayload(req),
  })
  const info = (result.data ?? { session_id: "", amount: 0, vnpay_ipn: "unknown_order" }) as VnpayWebhookData
  if (!info.session_id) {
    return { result, info }
  }
  try {
    const session = (await payment.retrievePaymentSession(info.session_id, {
      select: ["id", "provider_id", "status", "amount", "data"],
    })) as CheckedCallback["session"]
    if (session?.provider_id !== VNPAY_PROVIDER_ID) {
      return { result, info }
    }
    return { result, info, session }
  } catch {
    return { result, info }
  }
}
