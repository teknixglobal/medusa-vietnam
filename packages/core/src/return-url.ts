import { MedusaError } from "@medusajs/framework/utils"

/**
 * Parse a comma-separated origin list (same format as STORE_CORS).
 * Regex entries (starting with "/") are ignored: return URLs need exact origins.
 */
export function parseOrigins(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : (value ?? "").split(",")
  return list
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("/"))
    .map((s) => {
      try {
        return new URL(s).origin
      } catch {
        return ""
      }
    })
    .filter(Boolean)
}

/**
 * The storefront sends `return_url` when it creates the payment session.
 * Client data is untrusted, so only accept URLs on an allowed origin.
 * Falls back to `fallback` when the client sent nothing.
 */
export function resolveReturnUrl(
  candidate: unknown,
  allowedOrigins: string[],
  fallback?: string
): string {
  const raw = typeof candidate === "string" && candidate ? candidate : fallback
  if (!raw) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing return_url: send data.return_url when creating the payment session or set the provider option return_url"
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid return_url")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid return_url")
  }
  if (raw !== fallback && !allowedOrigins.includes(url.origin)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `return_url origin ${url.origin} is not allowed`
    )
  }
  return url.toString()
}

export function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}
