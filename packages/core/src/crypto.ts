import { createHmac, timingSafeEqual } from "crypto"

export type HmacAlgorithm = "sha256" | "sha512"

export function hmac(
  algorithm: HmacAlgorithm,
  key: string,
  data: string,
  encoding: "base64" | "hex"
): string {
  return createHmac(algorithm, key).update(data, "utf8").digest(encoding)
}

/** Constant-time string comparison. Different lengths return false. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false
  }
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) {
    return false
  }
  return timingSafeEqual(left, right)
}
