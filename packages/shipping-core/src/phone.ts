/**
 * Normalizes a Vietnamese phone number to the domestic form carriers expect:
 * 10-digit mobile ("0912345678") or 11-digit landline ("02838221234"). Accepts
 * spaces, dots, dashes, brackets and the +84 / 84 prefixes. Returns null otherwise.
 */
export function normalizeVnPhone(input: string | undefined | null): string | null {
  if (!input) {
    return null
  }
  let digits = String(input).replace(/[\s.\-()]/g, "")
  if (digits.startsWith("+84")) {
    digits = "0" + digits.slice(3)
  } else if (digits.startsWith("84") && (digits.length === 11 || digits.length === 12)) {
    digits = "0" + digits.slice(2)
  }
  return /^0[1-9]\d{8}$/.test(digits) || /^02\d{9}$/.test(digits) ? digits : null
}
