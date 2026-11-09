/** Carrier-neutral shipment status. Each carrier package maps its raw codes onto these. */
export const SHIPMENT_STATUSES = [
  "pending",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returning",
  "returned",
  "canceled",
  "lost",
  "exception",
  "unknown",
] as const

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

const FINAL: ReadonlySet<ShipmentStatus> = new Set([
  "delivered",
  "returned",
  "canceled",
  "lost",
  "exception",
])

/** No further carrier updates are expected. */
export function isFinalStatus(status: ShipmentStatus): boolean {
  return FINAL.has(status)
}

/**
 * What the Medusa side should do when a shipment reaches this status:
 * - mark_shipped: run createOrderShipmentWorkflow (once)
 * - mark_delivered: run markOrderFulfillmentAsDeliveredWorkflow
 * - flag: record it on the fulfillment and tell an admin, change nothing else
 * - none: just record it
 */
export type FulfillmentAction = "none" | "mark_shipped" | "mark_delivered" | "flag"

const ACTIONS: Record<ShipmentStatus, FulfillmentAction> = {
  pending: "none",
  picked_up: "mark_shipped",
  in_transit: "mark_shipped",
  out_for_delivery: "mark_shipped",
  delivered: "mark_delivered",
  delivery_failed: "flag",
  returning: "flag",
  returned: "flag",
  canceled: "flag",
  lost: "flag",
  exception: "flag",
  unknown: "none",
}

export function actionForStatus(status: ShipmentStatus): FulfillmentAction {
  return ACTIONS[status]
}

/**
 * Whether an update may replace the stored status. Final statuses are kept,
 * except that a carrier may still close an "exception" with a definite outcome.
 */
export function canTransition(from: ShipmentStatus | undefined, to: ShipmentStatus): boolean {
  if (from === to || to === "unknown") {
    return false
  }
  if (!from) {
    return true
  }
  if (from === "exception") {
    return to !== "pending"
  }
  return !isFinalStatus(from)
}

/** Builds a raw-code -> status mapper; unmapped codes become "unknown". */
export function createStatusMapper(
  table: Readonly<Record<string, ShipmentStatus>>
): (raw: string | undefined | null) => ShipmentStatus {
  const normalized = new Map<string, ShipmentStatus>()
  for (const [key, value] of Object.entries(table)) {
    normalized.set(key.trim().toLowerCase(), value)
  }
  return (raw) => (raw ? normalized.get(String(raw).trim().toLowerCase()) : undefined) ?? "unknown"
}
