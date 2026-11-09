import { CarrierError } from "@teknixglobal/medusa-vietnam-shipping-core"

export type GhnEnv = "staging" | "production"

export const GHN_BASE_URLS: Record<GhnEnv, string> = {
  staging: "https://dev-online-gateway.ghn.vn",
  production: "https://online-gateway.ghn.vn",
}

/** Public tracking page (opens for production orders). */
export const GHN_TRACKING_URL = "https://donhang.ghn.vn/?order_code="

export type GhnClientOptions = {
  env: GhnEnv
  token: string
  shop_id: number
  timeout_ms?: number
  fetch?: typeof fetch
}

type Envelope<T> = { code?: number; message?: string; code_message?: string; data?: T }

/** Body shared by shipping-order/preview and /create (GHN field names). */
export type GhnOrderBody = {
  payment_type_id: 1 | 2
  required_note: "KHONGCHOXEMHANG" | "CHOXEMHANGKHONGTHU" | "CHOTHUHANG"
  service_type_id: number
  client_order_code?: string
  weight: number
  length: number
  width: number
  height: number
  cod_amount: number
  insurance_value: number
  content?: string
  note?: string
  from_name: string
  from_phone: string
  from_address: string
  from_ward_name: string
  from_province_name: string
  is_new_from_address: true
  to_name: string
  to_phone: string
  to_address: string
  to_ward_name: string
  to_province_name: string
  is_new_to_address: true
  items: { name: string; quantity: number; weight?: number }[]
}

export type GhnOrderResult = {
  order_code: string
  total_fee?: number
  expected_delivery_time?: string
  sort_code?: string
  fee?: Record<string, number>
}

export type GhnOrderDetail = {
  order_code: string
  client_order_code?: string
  status: string
  cod_amount?: number
  cod_transfer_date?: string | null
  updated_date?: string
  leadtime?: string
  to_ward_id_v2?: number
  to_province_id_v2?: number
  to_ward_code?: string
  to_district_id?: number
  to_location?: { lat?: number; long?: number; trust_level?: number }
}

export type GhnSwitchResult = { order_code: string; result: boolean; message?: string }

const ERROR_CODES: Record<string, ConstructorParameters<typeof CarrierError>[1]> = {
  COD_IS_OVER_LIMIT: "COD_TOO_HIGH",
  PHONE_INVALID: "INVALID_PHONE",
  FROM_ADDRESS_CONVERT_FAIL: "INVALID_ADDRESS",
  TO_ADDRESS_CONVERT_FAIL: "INVALID_ADDRESS",
  CLIENT_NOT_OWNER_OF_SHOP: "UNAUTHORIZED",
}

/** GHN responses sometimes carry raw control characters inside strings. */
export function parseGhnJson<T>(text: string): T {
  return JSON.parse(text.replace(/[\u0000-\u001f]/g, " ")) as T
}

/** Thin client over the GHN v2/v3 endpoints the provider needs. Never logs the token. */
export class GhnClient {
  readonly env: GhnEnv
  private readonly token: string
  private readonly shopId: number
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: GhnClientOptions) {
    this.env = options.env
    this.token = options.token
    this.shopId = options.shop_id
    this.timeoutMs = options.timeout_ms ?? 8000
    this.fetchImpl = options.fetch ?? fetch
  }

  get baseUrl(): string {
    return GHN_BASE_URLS[this.env]
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Token: this.token,
          ShopId: String(this.shopId),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      const aborted = (error as Error)?.name === "AbortError"
      throw new CarrierError("ghn", aborted ? "TIMEOUT" : "CARRIER_UNAVAILABLE", aborted ? `no answer after ${this.timeoutMs} ms` : "network error", {
        cause: error,
      })
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    let envelope: Envelope<T>
    try {
      envelope = parseGhnJson<Envelope<T>>(text)
    } catch {
      throw new CarrierError("ghn", res.status >= 500 ? "CARRIER_UNAVAILABLE" : "BAD_RESPONSE", `HTTP ${res.status}, not JSON`)
    }
    const code = envelope.code ?? res.status
    if (code === 200 && res.ok) {
      return envelope.data as T
    }
    const details = { http: res.status, code, code_message: envelope.code_message, message: envelope.message }
    if (res.status === 401 || code === 401) {
      throw new CarrierError("ghn", "UNAUTHORIZED", envelope.message ?? "token rejected", { details })
    }
    if (res.status >= 500 || code >= 500 || res.status === 429) {
      throw new CarrierError("ghn", "CARRIER_UNAVAILABLE", envelope.message ?? `HTTP ${res.status}`, { details })
    }
    const mapped = (envelope.code_message && ERROR_CODES[envelope.code_message]) || "CARRIER_REJECTED"
    throw new CarrierError("ghn", mapped, envelope.message ?? envelope.code_message ?? `code ${code}`, { details })
  }

  provinces(): Promise<{ _id: number; name: string; extension_names?: string[]; status: number }[]> {
    return this.request("/shiip/public-api/v3/master-data/province/all?offset=0&limit=100")
  }

  wards(provinceId: number): Promise<{ _id: number; name: string; extension_names?: string[]; status: number }[]> {
    return this.request(`/shiip/public-api/v3/master-data/ward/all-by-province-id?province_id=${provinceId}&limit=500`)
  }

  /** Dry run of create: fee and ETA, no order is created (order_code is ""). */
  preview(body: GhnOrderBody): Promise<GhnOrderResult> {
    return this.request("/shiip/public-api/v2/shipping-order/preview", body)
  }

  /** Same client_order_code twice returns the first order (idempotent). */
  create(body: GhnOrderBody): Promise<GhnOrderResult> {
    return this.request("/shiip/public-api/v2/shipping-order/create", body)
  }

  detail(orderCode: string): Promise<GhnOrderDetail> {
    return this.request("/shiip/public-api/v2/shipping-order/detail", { order_code: orderCode })
  }

  detailByClientCode(clientOrderCode: string): Promise<GhnOrderDetail> {
    return this.request("/shiip/public-api/v2/shipping-order/detail-by-client-code", {
      client_order_code: clientOrderCode,
    })
  }

  /** HTTP 200 even when an order fails: check each result. */
  cancel(orderCodes: string[], reason = "Shop cancelled"): Promise<GhnSwitchResult[]> {
    return this.request("/shiip/public-api/v2/switch-status/cancel", {
      order_codes: orderCodes,
      reason_code: "GHN-CANCEL-OTHER",
      reason,
    })
  }

  /** HTTP 200 even when an order fails: check each result. */
  returnOrders(orderCodes: string[]): Promise<GhnSwitchResult[]> {
    return this.request("/shiip/public-api/v2/switch-status/return", { order_codes: orderCodes })
  }

  async printToken(orderCodes: string[]): Promise<string> {
    const data = await this.request<{ token: string }>("/shiip/public-api/v2/a5/gen-token", { order_codes: orderCodes })
    if (!data?.token) {
      throw new CarrierError("ghn", "BAD_RESPONSE", "gen-token returned no token")
    }
    return data.token
  }

  /** HTML label page, valid ~30 minutes after printToken. */
  printUrl(token: string, format: "A5" | "80x80" | "52x70" = "A5"): string {
    const page = format === "A5" ? "printA5" : `print${format}`
    return `${this.baseUrl}/a5/public-api/${page}?token=${encodeURIComponent(token)}`
  }
}
