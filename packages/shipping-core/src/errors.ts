export type CarrierErrorCode =
  | "INVALID_ADDRESS"
  | "INVALID_PHONE"
  | "PARCEL_TOO_LARGE"
  | "COD_TOO_HIGH"
  | "NOT_SUPPORTED"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "CARRIER_REJECTED"
  | "CARRIER_UNAVAILABLE"
  | "BAD_RESPONSE"

/** Error raised by carrier adapters. `retryable` means the same call may succeed later. */
export class CarrierError extends Error {
  readonly carrier: string
  readonly code: CarrierErrorCode
  readonly retryable: boolean
  /** Carrier's own error code/message, safe to log (never credentials). */
  readonly details?: Record<string, unknown>

  constructor(
    carrier: string,
    code: CarrierErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {}
  ) {
    super(`[${carrier}] ${code}: ${message}`)
    this.name = "CarrierError"
    this.carrier = carrier
    this.code = code
    this.retryable = options.retryable ?? (code === "TIMEOUT" || code === "CARRIER_UNAVAILABLE")
    this.details = options.details
    if (options.cause !== undefined) {
      // Error options need ES2022; the repo targets ES2021.
      Object.defineProperty(this, "cause", { value: options.cause, enumerable: false })
    }
  }
}

export function isCarrierError(error: unknown): error is CarrierError {
  return error instanceof CarrierError
}
