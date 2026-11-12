import { safeEqual } from "@teknixglobal/teknix-vietnam-core"
import { MemoryTtlCache, type ShippingCache } from "./cache"
import type { HeaderBag } from "./types"

/** Case-insensitive header lookup; the first value when repeated. */
export function headerValue(headers: HeaderBag, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

/**
 * For carriers whose webhooks are not signed (GHN, GrabExpress): the shop sets
 * a long random secret as a custom header in the carrier portal and we compare
 * it in constant time. An empty configured secret never matches.
 */
export function verifySharedSecretHeader(
  headers: HeaderBag,
  headerName: string,
  secret: string | undefined
): boolean {
  if (!secret) {
    return false
  }
  return safeEqual(headerValue(headers, headerName), secret)
}

/**
 * Remembers webhook events already handled so carrier retries are skipped.
 * Use a shared cache (Redis via the Caching Module) when running more than
 * one server; handlers must stay idempotent anyway.
 */
export class WebhookDeduper {
  constructor(
    private readonly cache: ShippingCache = new MemoryTtlCache(10_000),
    private readonly ttlSeconds = 7 * 24 * 3600
  ) {}

  /** True if this event was already handled. */
  async seen(key: string): Promise<boolean> {
    return (await this.cache.get<boolean>(`ship-webhook:${key}`)) === true
  }

  /**
   * Call only after the event was handled successfully, so a failed attempt
   * is processed again when the carrier retries.
   */
  async remember(key: string): Promise<void> {
    await this.cache.set(`ship-webhook:${key}`, true, this.ttlSeconds)
  }
}
