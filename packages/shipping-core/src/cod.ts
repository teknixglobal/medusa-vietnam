/**
 * Metadata key on a Medusa order holding the whole-VND amount the carrier must
 * collect on delivery. Written once the payment method is known (a subscriber
 * in the carrier plugin), read by the fulfillment provider. Absent = prepaid.
 */
export const VN_COD_METADATA_KEY = "vn_shipping_cod_amount" as const

/** Reads the COD amount from order metadata: whole, non-negative VND, 0 when absent or invalid. */
export function readCodAmount(order: { metadata?: Record<string, unknown> | null } | null | undefined): number {
  const raw = order?.metadata?.[VN_COD_METADATA_KEY]
  const n = typeof raw === "string" ? Number(raw) : raw
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * Metadata key on a Medusa order recording the automatic COD capture after delivery:
 * `{ status: "captured" | "blocked" | "failed", reason?, amount?, fulfillment_id, at }`.
 * "blocked" and "failed" need a person: check the carrier and capture in Admin by hand.
 */
export const VN_COD_CAPTURE_METADATA_KEY = "vn_cod_capture" as const

export type VnCodCaptureRecord = {
  status: "captured" | "blocked" | "failed"
  reason?: string
  amount?: number
  fulfillment_id: string
  at: string
}
