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
