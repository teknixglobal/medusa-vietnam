import {
  actionForStatus,
  canTransition,
  type ShipmentSnapshot,
  type ShipmentStatus,
} from "@teknixglobal/medusa-vietnam-shipping-core"
import type { GhnFulfillmentRef } from "./steps/ghn-sync"

export type GhnSyncPlan = {
  /** Nothing to do: unknown fulfillment, cancelled in Medusa, or no status change. */
  skip: boolean
  reason?: string
  fulfillment_id?: string
  order_id?: string
  data?: Record<string, unknown>
  previous?: Record<string, unknown>
  ship: boolean
  deliver: boolean
  flag: boolean
  items: { id: string; quantity: number }[]
}

/**
 * Pure decision for one GHN status update (kept outside the workflow so it can
 * be unit tested). Delivered without a recorded shipment ships first.
 */
export function planGhnSync(
  snapshot: ShipmentSnapshot,
  fulfillment: GhnFulfillmentRef | null,
  now: string,
  reported?: { reason?: string; reason_code?: string; raw_status?: string }
): GhnSyncPlan {
  const none = { ship: false, deliver: false, flag: false, items: [] }
  if (!fulfillment) {
    return { skip: true, reason: "fulfillment not found", ...none }
  }
  if (fulfillment.canceled_at) {
    return { skip: true, reason: "fulfillment cancelled in Medusa", ...none }
  }
  const previousStatus = fulfillment.data.shipment_status as ShipmentStatus | undefined
  const statusChanged = canTransition(previousStatus, snapshot.status)
  const action = actionForStatus(snapshot.status)
  const ship = (action === "mark_shipped" || action === "mark_delivered") && !fulfillment.shipped_at
  const deliver = action === "mark_delivered" && !fulfillment.delivered_at
  const codChanged =
    snapshot.cod_transfer_date !== undefined && snapshot.cod_transfer_date !== fulfillment.data.ghn_cod_transfer_date
  if (!statusChanged && !ship && !deliver && !codChanged) {
    return { skip: true, reason: "no change", ...none }
  }
  if ((ship || deliver) && !fulfillment.order_id) {
    return { skip: true, reason: "fulfillment has no order_id", ...none }
  }
  const data: Record<string, unknown> = {
    ...fulfillment.data,
    ghn_status: snapshot.raw_status,
    shipment_status: statusChanged ? snapshot.status : previousStatus,
    ghn_synced_at: now,
  }
  if (snapshot.cod_transfer_date !== undefined) {
    data.ghn_cod_transfer_date = snapshot.cod_transfer_date
  }
  // COD as GHN has it now (it can be edited in the GHN portal); checked before any capture.
  if (typeof snapshot.cod_amount === "number") {
    data.ghn_cod_reported = snapshot.cod_amount
  }
  // The webhook's reason is unsigned: shown to staff only when GHN confirms the same status.
  if (reported?.reason && reported.raw_status === snapshot.raw_status) {
    data.ghn_reason = reported.reason
    data.ghn_reason_code = reported.reason_code
  } else if (statusChanged) {
    delete data.ghn_reason
    delete data.ghn_reason_code
  }
  const flag = statusChanged && action === "flag"
  if (flag) {
    data.shipment_flag = snapshot.status
  }
  return {
    skip: false,
    fulfillment_id: fulfillment.id,
    order_id: fulfillment.order_id,
    data,
    previous: fulfillment.data,
    ship,
    deliver,
    flag,
    items: fulfillment.items.map((i) => ({ id: i.line_item_id, quantity: i.quantity })),
  }
}

/**
 * Order total to collect when the order is paid with a COD provider (pp_cod_*).
 * Uses the payments of the order; authorized sessions only when there is no payment
 * (sessions left over from a method the customer switched away from are ignored).
 */
export function codAmountForOrder(order: {
  total?: unknown
  payment_collections?: {
    payments?: { provider_id?: string }[]
    payment_sessions?: { provider_id?: string; status?: string }[]
  }[]
}, providerPrefixes: readonly string[] = ["pp_cod_"]): number {
  const collections = order.payment_collections ?? []
  const payments = collections.flatMap((pc) => (pc.payments ?? []).map((p) => p.provider_id))
  const providers = payments.length
    ? payments
    : collections.flatMap((pc) =>
        (pc.payment_sessions ?? []).filter((s) => s.status === "authorized").map((s) => s.provider_id)
      )
  const isCod = providers.some((id) => id && providerPrefixes.some((prefix) => id.startsWith(prefix)))
  const raw = order.total as { numeric?: unknown } | number | string | undefined
  const total = Number(typeof raw === "object" && raw !== null && "numeric" in raw ? raw.numeric : raw)
  return isCod && Number.isFinite(total) && total > 0 ? Math.round(total) : 0
}

type Amount = unknown

export type CodCaptureFulfillment = {
  id: string
  provider_id?: string | null
  data?: Record<string, unknown> | null
  delivered_at?: Date | string | null
  canceled_at?: Date | string | null
}

export type CodCaptureOrder = {
  id: string
  fulfillments?: CodCaptureFulfillment[] | null
  payment_collections?: {
    payments?: {
      id: string
      provider_id?: string
      amount?: Amount
      captured_at?: Date | string | null
      canceled_at?: Date | string | null
      captures?: { amount?: Amount }[] | null
    }[] | null
  }[] | null
}

export type CodCapturePlan =
  | { action: "capture"; payment_id: string; amount: number }
  | { action: "skip"; reason: string }
  | { action: "block"; reason: string }

function num(raw: Amount): number {
  const v = typeof raw === "object" && raw !== null && "numeric" in raw ? (raw as { numeric: unknown }).numeric : raw
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Decides whether a delivered fulfillment lets us capture the order's COD payment.
 * Captures only when GHN itself reported the delivery (shipment_status written by the
 * sync workflow from a re-read, not a manual "mark as delivered"), every live
 * fulfillment of the order is delivered, and the COD GHN collects equals the payment.
 * Anything unexpected blocks: a person checks it.
 */
export function planCodCapture(
  delivered: CodCaptureFulfillment,
  order: CodCaptureOrder,
  ghnProviderId: string,
  codPrefixes: readonly string[] = ["pp_cod_"]
): CodCapturePlan {
  if (delivered.provider_id !== ghnProviderId) {
    return { action: "skip", reason: "not a GHN fulfillment" }
  }
  const payments = (order.payment_collections ?? [])
    .flatMap((pc) => pc.payments ?? [])
    .filter((p) => !p.canceled_at && codPrefixes.some((prefix) => String(p.provider_id ?? "").startsWith(prefix)))
  if (!payments.length) {
    return { action: "skip", reason: "no COD payment" }
  }
  const open = payments
    .map((p) => {
      const captured = (p.captures ?? []).reduce((sum, c) => sum + num(c.amount), 0)
      return { id: p.id, amount: Math.round(num(p.amount)), remaining: Math.round(num(p.amount) - captured), captured_at: p.captured_at }
    })
    .filter((p) => !p.captured_at && p.remaining > 0)
  if (!open.length) {
    return { action: "skip", reason: "COD already captured" }
  }
  if (delivered.data?.shipment_status !== "delivered") {
    return { action: "block", reason: "marked delivered in Medusa but GHN has not reported the delivery" }
  }
  if (open.length > 1) {
    return { action: "block", reason: `${open.length} uncaptured COD payments` }
  }
  const live = (order.fulfillments ?? []).filter((f) => !f.canceled_at)
  if (live.some((f) => f.id !== delivered.id && !f.delivered_at)) {
    return { action: "skip", reason: "other shipments of the order are not delivered yet" }
  }
  const edited = live.find(
    (f) => typeof f.data?.ghn_cod_reported === "number" && f.data.ghn_cod_reported !== num(f.data?.ghn_cod_amount)
  )
  if (edited) {
    return { action: "block", reason: `GHN reports COD ${edited.data?.ghn_cod_reported} VND on ${edited.id}, sent ${num(edited.data?.ghn_cod_amount)} VND` }
  }
  const collected = live.reduce((sum, f) => sum + Math.round(num(f.data?.ghn_cod_amount)), 0)
  const payment = open[0]
  if (collected !== payment.amount) {
    return { action: "block", reason: `GHN collects ${collected} VND, COD payment is ${payment.amount} VND` }
  }
  return { action: "capture", payment_id: payment.id, amount: payment.remaining }
}
