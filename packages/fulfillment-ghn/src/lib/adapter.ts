import {
  assertWithinCapabilities,
  CarrierError,
  verifySharedSecretHeader,
  type CarrierAdapter,
  type CarrierCapabilities,
  type HeaderBag,
  type Quote,
  type QuoteRequest,
  type Shipment,
  type ShipmentRequest,
  type ShipmentSnapshot,
  type VnContact,
  type WebhookEvent,
} from "@teknixglobal/teknix-vietnam-shipping-core"
import { ghnPlaceFor } from "./address-map"
import { GHN_TRACKING_URL, GhnClient, type GhnClientOptions, type GhnOrderBody, type GhnSwitchResult } from "./client"
import { ghnStatus } from "./status"

export const DEFAULT_WEBHOOK_HEADER = "X-Teknix-Webhook-Secret"

export type GhnAdapterOptions = GhnClientOptions & {
  /** Pickup address. Required: GHN rejects orders without one when the shop has no default address. */
  pickup?: VnContact
  /** COD cap of this GHN account (production accounts can be far below the documented 50 000 000). */
  cod_max?: number
  /** 1 = shop pays GHN (default: the customer already paid shipping in the order), 2 = recipient pays. */
  payment_type_id?: 1 | 2
  required_note?: GhnOrderBody["required_note"]
  /** Secret set as a custom header in the GHN portal webhook config. */
  webhook_secret?: string
  webhook_header?: string
  /** Used for quotes while the cart has no recipient name/phone yet (GHN requires both). */
  quote_placeholder_name?: string
}

function contactFields(prefix: "from" | "to", contact: VnContact) {
  const place = ghnPlaceFor(contact)
  return {
    [`${prefix}_name`]: contact.name,
    [`${prefix}_phone`]: contact.phone,
    [`${prefix}_address`]: contact.address_line,
    [`${prefix}_ward_name`]: place.ward_name,
    [`${prefix}_province_name`]: place.province_name,
    [`is_new_${prefix}_address`]: true,
  }
}

function checkSwitch(results: GhnSwitchResult[] | undefined, code: string, action: string): void {
  const result = results?.find((r) => r.order_code === code)
  if (!result?.result) {
    throw new CarrierError("ghn", "CARRIER_REJECTED", `${action} ${code}: ${result?.message ?? "no result"}`)
  }
}

/** GHN implementation of the shared carrier contract. */
export class GhnAdapter implements CarrierAdapter {
  readonly code = "ghn"
  readonly capabilities: CarrierCapabilities
  readonly client: GhnClient

  constructor(private readonly options: GhnAdapterOptions, client?: GhnClient) {
    this.client = client ?? new GhnClient(options)
    this.capabilities = {
      labels: true,
      returns: true,
      cod_max: options.cod_max ?? 50_000_000,
      requires_geo: false,
      max_weight_g: 50_000,
      max_side_cm: 200,
    }
  }

  private pickup(from?: VnContact): VnContact {
    const pickup = from ?? this.options.pickup
    if (!pickup) {
      throw new CarrierError("ghn", "INVALID_ADDRESS", "no pickup address: set options.pickup or the stock location address")
    }
    return pickup
  }

  private body(request: QuoteRequest | ShipmentRequest, to: VnContact): GhnOrderBody {
    const serviceType = Number(request.service)
    if (!Number.isInteger(serviceType)) {
      throw new CarrierError("ghn", "NOT_SUPPORTED", `service ${request.service} is not a GHN service_type_id`)
    }
    assertWithinCapabilities("ghn", this.capabilities, request.parcel, request.cod_amount)
    const shipment = request as Partial<ShipmentRequest>
    const items = shipment.items?.length
      ? shipment.items.map((i) => ({ name: i.name.slice(0, 200), quantity: i.quantity, weight: i.weight_g }))
      : [{ name: shipment.content ?? "Hàng hoá", quantity: 1, weight: request.parcel.weight_g }]
    return {
      payment_type_id: this.options.payment_type_id ?? 1,
      required_note: this.options.required_note ?? "KHONGCHOXEMHANG",
      service_type_id: serviceType,
      client_order_code: shipment.reference,
      weight: request.parcel.weight_g,
      length: request.parcel.length_cm,
      width: request.parcel.width_cm,
      height: request.parcel.height_cm,
      cod_amount: Math.max(0, Math.round(request.cod_amount)),
      insurance_value: Math.min(Math.max(0, Math.round(request.insurance_value ?? 0)), 5_000_000),
      content: shipment.content?.slice(0, 2000),
      note: shipment.note?.slice(0, 5000),
      ...contactFields("from", this.pickup(request.from)),
      ...contactFields("to", to),
      items,
    } as GhnOrderBody
  }

  async quote(request: QuoteRequest): Promise<Quote> {
    // GHN prices only through preview, which validates name/phone/address like create.
    // The fee does not depend on them (checked on the API), so placeholders are fine.
    const pickup = this.pickup(request.from)
    const to: VnContact = {
      province_code: request.to.province_code,
      ward_code: request.to.ward_code,
      name: request.to.name || this.options.quote_placeholder_name || "Khach hang",
      phone: request.to.phone || pickup.phone,
      address_line: request.to.address_line || "-",
    }
    const result = await this.client.preview({ ...this.body(request, to), client_order_code: undefined })
    if (typeof result?.total_fee !== "number") {
      throw new CarrierError("ghn", "BAD_RESPONSE", "preview returned no total_fee")
    }
    return {
      amount: result.total_fee,
      service: request.service,
      eta: result.expected_delivery_time ? { to: result.expected_delivery_time } : undefined,
    }
  }

  async createShipment(request: ShipmentRequest): Promise<Shipment> {
    if (!request.reference || request.reference.length > 50) {
      throw new CarrierError("ghn", "NOT_SUPPORTED", "reference (client_order_code) must be 1-50 characters")
    }
    const result = await this.client.create(this.body(request, request.to))
    if (!result?.order_code) {
      throw new CarrierError("ghn", "BAD_RESPONSE", "create returned no order_code")
    }
    return {
      carrier_order_code: result.order_code,
      reference: request.reference,
      fee: result.total_fee,
      tracking_url: GHN_TRACKING_URL + encodeURIComponent(result.order_code),
      eta: result.expected_delivery_time ? { to: result.expected_delivery_time } : undefined,
      data: { sort_code: result.sort_code, env: this.client.env },
    }
  }

  async cancelShipment(carrierOrderCode: string): Promise<void> {
    checkSwitch(await this.client.cancel([carrierOrderCode]), carrierOrderCode, "cancel")
  }

  async getShipment(carrierOrderCode: string): Promise<ShipmentSnapshot> {
    const d = await this.client.detail(carrierOrderCode)
    return {
      carrier_order_code: d.order_code,
      reference: d.client_order_code,
      raw_status: d.status,
      status: ghnStatus(d.status),
      cod_amount: d.cod_amount,
      cod_transfer_date: d.cod_transfer_date ?? undefined,
      updated_at: d.updated_date,
    }
  }

  async createReturn(carrierOrderCode: string): Promise<void> {
    checkSwitch(await this.client.returnOrders([carrierOrderCode]), carrierOrderCode, "return")
  }

  async getLabelUrl(carrierOrderCodes: string[], format?: string): Promise<string> {
    const size = format === "80x80" || format === "52x70" ? format : "A5"
    return this.client.printUrl(await this.client.printToken(carrierOrderCodes), size)
  }

  verifyWebhook(headers: HeaderBag, body: unknown): boolean {
    if (!verifySharedSecretHeader(headers, this.options.webhook_header ?? DEFAULT_WEBHOOK_HEADER, this.options.webhook_secret)) {
      return false
    }
    const shopId = (body as { ShopID?: unknown } | null)?.ShopID
    return shopId === undefined || Number(shopId) === Number(this.options.shop_id)
  }

  parseWebhook(body: unknown): WebhookEvent[] {
    const b = body as Record<string, unknown> | null
    const orderCode = typeof b?.OrderCode === "string" ? b.OrderCode : undefined
    if (!b || !orderCode) {
      throw new CarrierError("ghn", "BAD_RESPONSE", "webhook body has no OrderCode")
    }
    const raw = typeof b.Status === "string" ? b.Status : ""
    const type = typeof b.Type === "string" ? b.Type : undefined
    const time = typeof b.Time === "string" ? b.Time : new Date().toISOString()
    return [
      {
        carrier_order_code: orderCode,
        reference: typeof b.ClientOrderCode === "string" && b.ClientOrderCode ? b.ClientOrderCode : undefined,
        type,
        raw_status: raw,
        status: ghnStatus(raw),
        occurred_at: time,
        dedupe_key: `ghn:${orderCode}:${type ?? ""}:${time}`,
        account_id: b.ShopID === undefined ? undefined : String(b.ShopID),
        reason: typeof b.Reason === "string" && b.Reason ? b.Reason : undefined,
        reason_code: typeof b.ReasonCode === "string" && b.ReasonCode ? b.ReasonCode : undefined,
      },
    ]
  }
}

