import { createStatusMapper } from "@teknixglobal/medusa-vietnam-shipping-core"

/** GHN order status codes (developer.ghn.vn, Order Status Codes) -> neutral status. */
export const GHN_STATUS_TABLE = {
  ready_to_pick: "pending",
  picking: "pending",
  money_collect_picking: "pending",
  picked: "picked_up",
  storing: "in_transit",
  sorting: "in_transit",
  transporting: "in_transit",
  delivering: "out_for_delivery",
  money_collect_delivering: "out_for_delivery",
  delivered: "delivered",
  delivery_fail: "delivery_failed",
  waiting_to_return: "returning",
  return: "returning",
  return_transporting: "returning",
  return_sorting: "returning",
  returning: "returning",
  return_fail: "returning",
  returned: "returned",
  cancel: "canceled",
  exception: "exception",
  lost: "lost",
  damage: "lost",
  scrap: "lost",
} as const

export const ghnStatus = createStatusMapper(GHN_STATUS_TABLE)
