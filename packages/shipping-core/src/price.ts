import type { ShippingCache } from "./cache"
import { CarrierError } from "./errors"
import type { Quote, QuoteRequest } from "./types"

/** Whole, non-negative VND (carriers return integers; free shipping is 0). */
export function toShippingAmount(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number)
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid shipping amount: ${String(value)}`)
  }
  return Math.ceil(n)
}

/** Rejects with a retryable TIMEOUT CarrierError when the promise takes too long. */
export async function withTimeout<T>(carrier: string, promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CarrierError(carrier, "TIMEOUT", `no answer after ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cache key for a quote. Weight is rounded up to 100 g and COD to 100 000 VND
 * so nearby carts share an entry; carriers price in steps at least that coarse.
 * (Assumption to confirm per carrier during sandbox tests.)
 */
export function quoteCacheKey(carrier: string, request: QuoteRequest): string {
  const p = request.parcel
  const from = request.from ? request.from.ward_code : "default"
  return [
    "ship-quote",
    carrier,
    request.service,
    from,
    request.to.ward_code,
    Math.ceil(p.weight_g / 100) * 100,
    `${p.length_cm}x${p.width_cm}x${p.height_cm}`,
    Math.ceil(request.cod_amount / 100_000) * 100_000,
    request.insurance_value ?? 0,
  ].join(":")
}

export type QuoteResult = {
  amount: number
  source: "carrier" | "cache" | "fallback"
  quote?: Quote
  error?: unknown
}

export type QuoteOptions = {
  carrier: string
  /** Price to show when the carrier fails. Omit to let the error reach checkout. */
  fallback_amount?: number
  timeout_ms?: number
  cache?: ShippingCache
  cache_ttl_seconds?: number
}

/**
 * Quote for checkout: cache first, then the carrier with a timeout, then the
 * fallback price. Medusa calls calculatePrice on every cart refresh and a
 * thrown error blocks checkout, so a fallback should normally be configured.
 */
export async function quoteWithFallback(
  request: QuoteRequest,
  fetchQuote: (request: QuoteRequest) => Promise<Quote>,
  options: QuoteOptions
): Promise<QuoteResult> {
  const key = quoteCacheKey(options.carrier, request)
  if (options.cache) {
    const cached = await options.cache.get<Quote>(key).catch(() => undefined)
    if (cached) {
      return { amount: cached.amount, source: "cache", quote: cached }
    }
  }
  try {
    const quote = await withTimeout(options.carrier, fetchQuote(request), options.timeout_ms ?? 3000)
    const amount = toShippingAmount(quote.amount)
    const normalized = { ...quote, amount }
    if (options.cache) {
      await options.cache.set(key, normalized, options.cache_ttl_seconds ?? 3600).catch(() => undefined)
    }
    return { amount, source: "carrier", quote: normalized }
  } catch (error) {
    if (options.fallback_amount === undefined) {
      throw error
    }
    return { amount: toShippingAmount(options.fallback_amount), source: "fallback", error }
  }
}
