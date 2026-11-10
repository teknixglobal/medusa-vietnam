import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceContext,
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
  StockLocationDTO,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import {
  buildParcel,
  isCarrierError,
  MemoryTtlCache,
  normalizeVnPhone,
  quoteWithFallback,
  readCodAmount,
  readVnAddress,
  type ParcelItem,
  type ParcelOptions,
  type VnContact,
} from "@teknixglobal/medusa-vietnam-shipping-core"
import { GhnAdapter } from "../../lib/adapter"
import type { GhnEnv, GhnOrderBody } from "../../lib/client"

/** GHN's maximum insurance_value (also enforced by the adapter). */
export const GHN_INSURANCE_MAX = 5_000_000

export type GhnPickupOption = {
  name: string
  phone: string
  /** House number and street. */
  address_line: string
  /** NSO codes (see @teknixglobal/medusa-vietnam-shipping-core listVnProvinces / listVnWards). */
  province_code: string
  ward_code: string
}

export type GhnProviderOptions = ParcelOptions & {
  /** "staging" (developer.ghn.dev token) or "production". Tokens only work on their own gateway. */
  env: GhnEnv
  token: string
  shop_id: number | string
  /**
   * Pickup address, used when the stock location has no `metadata.vn_address`.
   * Required unless every stock location shipping with GHN has one.
   */
  pickup?: GhnPickupOption
  /** COD cap of this GHN account. Production accounts can be far below the documented 50 000 000. */
  cod_max?: number
  /** Price shown at checkout when GHN fails or the address is incomplete. Omit to block checkout instead. */
  fallback_amount?: number
  /** GHN request timeout. Default 8000 ms; checkout quotes use quote_timeout_ms (default 4000). */
  timeout_ms?: number
  quote_timeout_ms?: number
  quote_cache_ttl_seconds?: number
  /** 1 = shop pays GHN (default), 2 = recipient pays GHN. */
  payment_type_id?: 1 | 2
  required_note?: GhnOrderBody["required_note"]
  /** Secret the GHN portal sends as a custom header on status webhooks. */
  webhook_secret?: string
  /** Header name for webhook_secret. Default X-Teknix-Webhook-Secret. */
  webhook_header?: string
  /**
   * Declare the goods value (GHN insurance_value, the basis for compensation on loss
   * or damage) = sum of unit_price x quantity of the shipped items. GHN charges an
   * insurance fee on it, so quotes include it too. Default false (nothing declared).
   */
  declare_value?: boolean
  /** Cap of the declared value. Default and maximum 5 000 000 (GHN limit). */
  insurance_max?: number
  /**
   * Capture the COD payment when GHN confirms the delivery (status re-read from GHN,
   * every fulfillment of the order delivered, GHN COD = payment amount). Default false.
   */
  capture_cod_on_delivery?: boolean
}

type InjectedDependencies = { logger: Logger }

type AddressLike = {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  phone?: string | null
  address_1?: string | null
  address_2?: string | null
  metadata?: Record<string, unknown> | null
}

export const GHN_FULFILLMENT_OPTIONS = [
  { id: "ghn-standard", name: "GHN - Giao hàng chuẩn", service_type_id: 2 },
  { id: "ghn-heavy", name: "GHN - Hàng nặng (từ 20 kg)", service_type_id: 5 },
  { id: "ghn-return", name: "GHN - Trả hàng", service_type_id: 2, is_return: true },
] as const

const ADDRESS_HINT =
  "GHN: chọn lại Tỉnh/Thành phố và Phường/Xã theo địa giới mới (2025) cho địa chỉ giao hàng."

function serviceTypeOf(optionData: Record<string, unknown> | undefined): number {
  const fromData = Number(optionData?.service_type_id)
  if (Number.isInteger(fromData) && fromData > 0) {
    return fromData
  }
  const option = GHN_FULFILLMENT_OPTIONS.find((o) => o.id === optionData?.id)
  return option?.service_type_id ?? 2
}

function personName(address: AddressLike | null | undefined): string {
  return [address?.first_name, address?.last_name].filter(Boolean).join(" ").trim() || address?.company?.trim() || ""
}

function streetLine(address: AddressLike | null | undefined): string {
  return [address?.address_1, address?.address_2].filter((s) => s && s.trim()).join(", ")
}

/** BigNumber-safe number: Medusa returns totals as numbers or { numeric }. */
function toNumber(raw: unknown): number {
  const v = typeof raw === "object" && raw !== null && "numeric" in raw ? (raw as { numeric: unknown }).numeric : raw
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Value of the goods in a parcel (unit_price x quantity), rounded to whole VND. */
export function goodsValue(items: { unit_price?: unknown; quantity?: unknown }[]): number {
  return Math.round(items.reduce((sum, i) => sum + Math.max(0, toNumber(i.unit_price)) * Math.max(0, toNumber(i.quantity)), 0))
}

function toParcelItem(item: {
  quantity: unknown
  variant?: { weight?: number | null; length?: number | null; width?: number | null; height?: number | null } | null
}): ParcelItem {
  return {
    quantity: item.quantity as ParcelItem["quantity"],
    weight: item.variant?.weight,
    length: item.variant?.length,
    width: item.variant?.width,
    height: item.variant?.height,
  }
}

/**
 * GHN fulfillment provider (`ghn_<id>`). Prices are calculated through GHN's
 * preview endpoint on the 2025 two-tier address map; addresses must carry
 * `metadata.vn_address` (see shipping-core buildVnAddress).
 */
class GhnFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "ghn"

  protected readonly logger_: Logger
  protected readonly options_: GhnProviderOptions
  protected readonly adapter_: GhnAdapter
  protected readonly quoteCache_ = new MemoryTtlCache(2000)

  static validateOptions(options: Record<string, unknown>): void {
    const o = options as Partial<GhnProviderOptions>
    if (o.env !== "staging" && o.env !== "production") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, 'GHN: options.env must be "staging" or "production"')
    }
    if (!o.token) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "GHN: options.token is required")
    }
    if (!Number.isInteger(Number(o.shop_id)) || Number(o.shop_id) <= 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "GHN: options.shop_id is required")
    }
    if (o.pickup) {
      if (!normalizeVnPhone(o.pickup.phone)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "GHN: options.pickup.phone is not a Vietnamese phone number")
      }
      if (!readVnAddress({ metadata: { vn_address: { scheme: "2025", province_code: o.pickup.province_code, ward_code: o.pickup.ward_code } } })) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "GHN: options.pickup province_code/ward_code are not a valid 2025 pair")
      }
    }
    if (o.insurance_max !== undefined && !(Number(o.insurance_max) >= 0 && Number(o.insurance_max) <= GHN_INSURANCE_MAX)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `GHN: options.insurance_max must be 0-${GHN_INSURANCE_MAX}`)
    }
  }

  constructor({ logger }: InjectedDependencies, options: GhnProviderOptions) {
    super()
    this.logger_ = logger
    this.options_ = options
    const pickup = options.pickup
      ? { ...options.pickup, phone: normalizeVnPhone(options.pickup.phone) ?? options.pickup.phone }
      : undefined
    this.adapter_ = new GhnAdapter({
      env: options.env,
      token: options.token,
      shop_id: Number(options.shop_id),
      timeout_ms: options.timeout_ms,
      pickup,
      cod_max: options.cod_max,
      payment_type_id: options.payment_type_id,
      required_note: options.required_note,
      webhook_secret: options.webhook_secret,
      webhook_header: options.webhook_header,
    })
  }

  /** The carrier adapter, for the plugin's webhook route and jobs. */
  get adapter(): GhnAdapter {
    return this.adapter_
  }

  /** Declared value for GHN insurance, 0 unless options.declare_value. */
  private declaredValue(items: { unit_price?: unknown; quantity?: unknown }[]): number {
    if (!this.options_.declare_value) {
      return 0
    }
    return Math.min(goodsValue(items), this.options_.insurance_max ?? GHN_INSURANCE_MAX, GHN_INSURANCE_MAX)
  }

  private pickupFrom(location: StockLocationDTO | undefined | null): VnContact | undefined {
    const address = location?.address as (AddressLike & { metadata?: Record<string, unknown> | null }) | undefined
    const ref = readVnAddress(address)
    const phone = normalizeVnPhone(address?.phone)
    if (!ref || !phone || !address?.address_1) {
      return undefined
    }
    return {
      province_code: ref.province_code,
      ward_code: ref.ward_code,
      name: location?.name ?? "Kho",
      phone,
      address_line: streetLine(address),
    }
  }

  private toMedusaError(error: unknown): MedusaError {
    if (error instanceof MedusaError) {
      return error
    }
    if (isCarrierError(error)) {
      const type =
        error.code === "TIMEOUT" || error.code === "CARRIER_UNAVAILABLE" || error.code === "UNAUTHORIZED" || error.code === "BAD_RESPONSE"
          ? MedusaError.Types.UNEXPECTED_STATE
          : MedusaError.Types.INVALID_DATA
      return new MedusaError(type, error.message)
    }
    return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `GHN: ${(error as Error)?.message ?? String(error)}`)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return GHN_FULFILLMENT_OPTIONS.map((o) => ({ ...o }))
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return GHN_FULFILLMENT_OPTIONS.some((o) => o.id === data.id)
  }

  async canCalculate(): Promise<boolean> {
    return true
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext
  ): Promise<Record<string, unknown>> {
    if (!readVnAddress(context.shipping_address as AddressLike)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, ADDRESS_HINT)
    }
    return { ...data, service_type_id: serviceTypeOf(optionData) }
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: CalculateShippingOptionPriceContext
  ): Promise<CalculatedShippingOptionPrice> {
    const address = context.shipping_address as AddressLike | undefined
    const ref = readVnAddress(address)
    if (!ref) {
      if (this.options_.fallback_amount !== undefined) {
        return { calculated_amount: this.options_.fallback_amount, is_calculated_price_tax_inclusive: true }
      }
      throw new MedusaError(MedusaError.Types.INVALID_DATA, ADDRESS_HINT)
    }
    const request = {
      service: String(serviceTypeOf(optionData)),
      to: {
        province_code: ref.province_code,
        ward_code: ref.ward_code,
        name: personName(address) || undefined,
        phone: normalizeVnPhone(address?.phone) ?? undefined,
        address_line: streetLine(address) || undefined,
      },
      from: this.pickupFrom(context.from_location),
      parcel: buildParcel((context.items ?? []).map(toParcelItem), this.options_),
      // GHN's fee does not depend on the COD amount (checked on the API), and the
      // payment method is usually unknown while shipping is chosen.
      cod_amount: 0,
      insurance_value: this.declaredValue((context.items ?? []) as { unit_price?: unknown; quantity?: unknown }[]),
    }
    try {
      const result = await quoteWithFallback(request, (r) => this.adapter_.quote(r), {
        carrier: "ghn",
        fallback_amount: this.options_.fallback_amount,
        timeout_ms: this.options_.quote_timeout_ms ?? 4000,
        cache: this.quoteCache_,
        cache_ttl_seconds: this.options_.quote_cache_ttl_seconds ?? 3600,
      })
      if (result.source === "fallback") {
        this.logger_.warn(`GHN quote failed, using fallback price: ${(result.error as Error)?.message}`)
      }
      return { calculated_amount: result.amount, is_calculated_price_tax_inclusive: true }
    } catch (error) {
      throw this.toMedusaError(error)
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const address = ((fulfillment as { delivery_address?: AddressLike }).delivery_address ??
      order?.shipping_address) as AddressLike | undefined
    const ref = readVnAddress(address)
    if (!ref) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, ADDRESS_HINT)
    }
    const phone = normalizeVnPhone(address?.phone)
    if (!phone) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "GHN: địa chỉ giao hàng cần số điện thoại Việt Nam hợp lệ.")
    }
    const reference = String(fulfillment.id ?? "")
    const orderItems = new Map(
      ((order?.items ?? []) as { id: string; unit_price?: unknown; variant?: ParcelItemVariant | null }[]).map((i) => [i.id, i])
    )
    const insuranceValue = this.declaredValue(
      items.map((i) => ({ unit_price: orderItems.get(String(i.line_item_id))?.unit_price, quantity: i.quantity }))
    )
    const parcelItems = items.map((i) =>
      toParcelItem({ quantity: i.quantity, variant: orderItems.get(String(i.line_item_id))?.variant })
    )
    const codAmount = readCodAmount(order as { metadata?: Record<string, unknown> | null })
    try {
      const shipment = await this.adapter_.createShipment({
        reference,
        service: String(serviceTypeOf(data)),
        to: {
          province_code: ref.province_code,
          ward_code: ref.ward_code,
          name: personName(address) || "Khach hang",
          phone,
          address_line: streetLine(address) || "-",
        },
        parcel: buildParcel(parcelItems, this.options_),
        cod_amount: codAmount,
        insurance_value: insuranceValue,
        content: order?.display_id ? `Don hang #${order.display_id}` : undefined,
        items: items.map((i) => ({ name: String(i.title ?? "Hang hoa"), quantity: Number(i.quantity ?? 1) })),
      })
      return {
        data: {
          ghn_order_code: shipment.carrier_order_code,
          // Lets the status webhook find the order without a cross-module query.
          order_id: order?.id,
          ghn_env: this.adapter_.client.env,
          ghn_fee: shipment.fee,
          ghn_expected_delivery: shipment.eta?.to,
          ghn_sort_code: shipment.data?.sort_code,
          ghn_cod_amount: codAmount,
          ghn_insurance_value: insuranceValue,
          ghn_status: "ready_to_pick",
          shipment_status: "pending",
        },
        labels: [
          {
            tracking_number: shipment.carrier_order_code,
            tracking_url: shipment.tracking_url ?? "",
            // GHN label links expire after ~30 minutes: fetch a fresh one with retrieveDocuments("label").
            label_url: "",
          },
        ],
      }
    } catch (error) {
      throw this.toMedusaError(error)
    }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const code = typeof data?.ghn_order_code === "string" ? data.ghn_order_code : undefined
    if (!code) {
      return {}
    }
    try {
      await this.adapter_.cancelShipment(code)
      return { ...data, ghn_status: "cancel", shipment_status: "canceled" }
    } catch (error) {
      throw this.toMedusaError(error)
    }
  }

  /**
   * Customer returns are not booked with GHN through the API yet: the return is
   * recorded in Medusa and the shop books the pickup in the GHN portal. Failed
   * deliveries are sent back with the adapter's createReturn (GHN switch-status/return).
   */
  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    return { data: { ghn_return: "manual" }, labels: [] }
  }

  // The base class types these as Promise<never[]> / Promise<void>; Medusa passes the value through.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getFulfillmentDocuments(data: Record<string, unknown>): Promise<any> {
    const code = typeof data?.ghn_order_code === "string" ? data.ghn_order_code : undefined
    return code ? [{ type: "label", url: await this.adapter_.getLabelUrl([code]) }] : []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async retrieveDocuments(fulfillmentData: Record<string, unknown>, documentType: string): Promise<any> {
    if (documentType !== "label") {
      return []
    }
    return this.getFulfillmentDocuments(fulfillmentData)
  }
}

type ParcelItemVariant = { weight?: number | null; length?: number | null; width?: number | null; height?: number | null }

export default GhnFulfillmentService
