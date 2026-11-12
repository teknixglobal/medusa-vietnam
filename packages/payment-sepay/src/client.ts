import { hmac } from "@teknixglobal/teknix-vietnam-core"

export type SepayEnv = "sandbox" | "production"

export const SEPAY_URLS: Record<SepayEnv, { checkout: string; api: string }> = {
  sandbox: {
    checkout: "https://pay-sandbox.sepay.vn/v1/checkout/init",
    api: "https://pgapi-sandbox.sepay.vn/v1",
  },
  production: {
    checkout: "https://pay.sepay.vn/v1/checkout/init",
    api: "https://pgapi.sepay.vn/v1",
  },
}

/**
 * Signed fields, in the order given by the SePay docs
 * (developer.sepay.vn/en/cong-thanh-toan/API/don-hang/form-thanh-toan, 2026-11-09).
 * Empty, 0 and "0" values are skipped.
 */
export const SIGNED_FIELDS = [
  "order_amount",
  "merchant",
  "currency",
  "operation",
  "order_description",
  "order_invoice_number",
  "customer_id",
  "payment_method",
  "success_url",
  "error_url",
  "cancel_url",
] as const

export type SignedField = (typeof SIGNED_FIELDS)[number]

export type CheckoutFields = Partial<Record<SignedField, string>> & {
  lang?: "vi" | "en"
}

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value === "" || value === "0"
}

export function buildSigningString(fields: CheckoutFields): string {
  return SIGNED_FIELDS.filter((f) => !isEmpty(fields[f]))
    .map((f) => `${f}=${fields[f]}`)
    .join(",")
}

export function signCheckout(fields: CheckoutFields, secretKey: string): string {
  return hmac("sha256", secretKey, buildSigningString(fields), "base64")
}

/** Ordered form fields: signed fields in signing order, then lang, then signature. */
export function buildCheckoutForm(
  fields: CheckoutFields,
  secretKey: string
): [string, string][] {
  const out: [string, string][] = []
  for (const f of SIGNED_FIELDS) {
    const v = fields[f]
    if (!isEmpty(v)) {
      out.push([f, v as string])
    }
  }
  if (fields.lang) {
    out.push(["lang", fields.lang])
  }
  out.push(["signature", signCheckout(fields, secretKey)])
  return out
}

export type SepayOrderStatus = "CAPTURED" | "CANCELLED" | "AUTHENTICATION_NOT_NEEDED" | string

export type SepayOrder = {
  id?: string
  order_id?: string
  order_invoice_number: string
  order_status: SepayOrderStatus
  order_amount: string | number
  order_currency?: string
  transactions?: Array<{
    id?: string
    payment_method?: string
    transaction_type?: string
    transaction_status?: string
    transaction_amount?: string | number
    transaction_date?: string
  }>
}

export class SepayApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export class SepayClient {
  constructor(
    private readonly env: SepayEnv,
    private readonly merchantId: string,
    private readonly secretKey: string,
    private readonly timeoutMs = 10000
  ) {}

  get checkoutUrl(): string {
    return SEPAY_URLS[this.env].checkout
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.merchantId}:${this.secretKey}`).toString("base64")
    const res = await fetch(`${SEPAY_URLS[this.env].api}/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const text = await res.text()
    if (!res.ok) {
      // Body may echo request data; keep it short and never include headers.
      throw new SepayApiError(`SePay ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`, res.status)
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  /** Returns null when SePay has no order for this invoice (form never submitted). */
  async retrieveOrder(invoiceNumber: string): Promise<SepayOrder | null> {
    try {
      const res = await this.request<{ data?: SepayOrder }>(
        "GET",
        `order/detail/${encodeURIComponent(invoiceNumber)}`
      )
      return res.data ?? null
    } catch (e) {
      if (e instanceof SepayApiError && e.status === 404) {
        return null
      }
      throw e
    }
  }

  /** Only allowed for bank transfer orders that are neither captured nor cancelled. */
  async cancelOrder(invoiceNumber: string): Promise<void> {
    await this.request("POST", "order/cancel", { order_invoice_number: invoiceNumber })
  }
}
