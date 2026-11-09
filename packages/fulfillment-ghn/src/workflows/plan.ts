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
