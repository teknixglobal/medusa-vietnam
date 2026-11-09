import type { ShipmentStatus } from "./status"
import type { GeoPoint } from "./address"

/** Parcel in grams and centimetres, whole numbers. */
export type ParcelSpec = {
  weight_g: number
  length_cm: number
  width_cm: number
  height_cm: number
}

/**
 * A point on the 2025 two-tier map (province + ward, no district).
 * Codes are the official NSO codes from the bundled dataset; carrier
 * packages translate them to their own ids or names.
 */
export type VnLocation = {
  province_code: string
  ward_code: string
  geo?: GeoPoint
}

/** Full contact for creating a shipment. */
export type VnContact = VnLocation & {
  name: string
  /** Normalized Vietnamese phone, 10 digits starting with 0 (see normalizeVnPhone). */
  phone: string
  /** House number and street. */
  address_line: string
}

export type QuoteRequest = {
  /** Carrier service code (e.g. GHN service_type_id as a string). */
  service: string
  /** Name/phone may be missing at cart stage: the adapter decides what it needs. */
  to: VnLocation & Partial<Pick<VnContact, "name" | "phone" | "address_line">>
  /** Omitted: the carrier account's default pickup address. */
  from?: VnContact
  parcel: ParcelSpec
  /** Whole VND to collect from the recipient, 0 when prepaid. */
  cod_amount: number
  insurance_value?: number
}

export type DeliveryEstimate = {
  /** ISO 8601. */
  from?: string
  to?: string
}

export type Quote = {
  /** Whole VND, tax inclusive (carriers quote VAT-inclusive prices). */
  amount: number
  service: string
  eta?: DeliveryEstimate
}

export type ShipmentItem = {
  name: string
  quantity: number
  weight_g?: number
}

export type ShipmentRequest = {
  /** Our idempotency key (Medusa fulfillment id). Sending it twice must not create two shipments. */
  reference: string
  service: string
  to: VnContact
  from?: VnContact
  parcel: ParcelSpec
  cod_amount: number
  insurance_value?: number
  content?: string
  note?: string
  items?: ShipmentItem[]
}

export type Shipment = {
  carrier_order_code: string
  reference: string
  /** Whole VND charged by the carrier, if returned. */
  fee?: number
  tracking_url?: string
  eta?: DeliveryEstimate
  /** Carrier fields worth keeping on the fulfillment (no secrets). */
  data?: Record<string, unknown>
}

export type ShipmentSnapshot = {
  carrier_order_code: string
  reference?: string
  raw_status: string
  status: ShipmentStatus
  cod_amount?: number
  /** ISO 8601, when the carrier paid the COD out to the shop. */
  cod_transfer_date?: string
  /** ISO 8601. */
  updated_at?: string
}

export type WebhookEvent = {
  carrier_order_code: string
  reference?: string
  type?: string
  raw_status: string
  status: ShipmentStatus
  /** ISO 8601. */
  occurred_at: string
  /** Stable key for de-duplicating carrier retries. */
  dedupe_key: string
  /** The carrier account the event claims to come from (checked against config). */
  account_id?: string
}

export type CarrierCapabilities = {
  /** Printable labels (on-demand couriers usually have none). */
  labels: boolean
  /** API to send a parcel back to the shop. */
  returns: boolean
  /** Highest COD amount in whole VND, 0 if no COD. */
  cod_max: number
  /** Needs latitude/longitude on addresses (on-demand couriers). */
  requires_geo: boolean
  max_weight_g: number
  max_side_cm: number
}

export type HeaderBag = Record<string, string | string[] | undefined>

/**
 * What one carrier package implements. The Medusa fulfillment provider of
 * each carrier is a thin layer over this, so the rules for prices, statuses,
 * addresses and webhooks stay the same across carriers.
 */
export interface CarrierAdapter {
  readonly code: string
  readonly capabilities: CarrierCapabilities

  quote(request: QuoteRequest): Promise<Quote>
  createShipment(request: ShipmentRequest): Promise<Shipment>
  cancelShipment(carrierOrderCode: string): Promise<void>
  getShipment(carrierOrderCode: string): Promise<ShipmentSnapshot>

  /** Present only when capabilities.returns is true. */
  createReturn?(carrierOrderCode: string): Promise<void>
  /** Present only when capabilities.labels is true. */
  getLabelUrl?(carrierOrderCodes: string[], format?: string): Promise<string>

  /** Authenticates a webhook request. Must not throw. */
  verifyWebhook(headers: HeaderBag, body: unknown): boolean
  /** Turns a verified webhook body into events. Throws CarrierError on malformed bodies. */
  parseWebhook(body: unknown): WebhookEvent[]
}
