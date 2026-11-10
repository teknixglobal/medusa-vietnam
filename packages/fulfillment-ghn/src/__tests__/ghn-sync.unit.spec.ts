import type { ShipmentSnapshot } from "@teknixglobal/medusa-vietnam-shipping-core"
import { ghnRuntimeFrom } from "../lib/config"
import { codAmountForOrder, planCodCapture, planGhnSync } from "../workflows/plan"
import type { GhnFulfillmentRef } from "../workflows/steps/ghn-sync"

const NOW = "2026-11-09T16:00:00.000Z"
const snap = (raw: string, status: ShipmentSnapshot["status"], extra: Partial<ShipmentSnapshot> = {}): ShipmentSnapshot => ({
  carrier_order_code: "LYGF3R",
  reference: "ful_1",
  raw_status: raw,
  status,
  ...extra,
})
const ful = (extra: Partial<GhnFulfillmentRef> = {}): GhnFulfillmentRef => ({
  id: "ful_1",
  order_id: "order_1",
  data: { ghn_order_code: "LYGF3R", shipment_status: "pending", ghn_status: "ready_to_pick" },
  items: [{ line_item_id: "li_1", quantity: 2 }],
  ...extra,
})

describe("planGhnSync", () => {
  it("skips unknown, cancelled and unchanged fulfillments", () => {
    expect(planGhnSync(snap("picked", "picked_up"), null, NOW)).toMatchObject({ skip: true, reason: "fulfillment not found" })
    expect(planGhnSync(snap("picked", "picked_up"), ful({ canceled_at: NOW }), NOW)).toMatchObject({ skip: true })
    expect(planGhnSync(snap("ready_to_pick", "pending"), ful(), NOW)).toMatchObject({ skip: true, reason: "no change" })
  })

  it("ships once on pickup", () => {
    const plan = planGhnSync(snap("picked", "picked_up"), ful(), NOW)
    expect(plan).toMatchObject({ skip: false, ship: true, deliver: false, flag: false, order_id: "order_1", fulfillment_id: "ful_1" })
    expect(plan.items).toEqual([{ id: "li_1", quantity: 2 }])
    expect(plan.data).toMatchObject({ ghn_status: "picked", shipment_status: "picked_up", ghn_synced_at: NOW, ghn_order_code: "LYGF3R" })
    const again = planGhnSync(snap("transporting", "in_transit"), ful({ shipped_at: NOW, data: { ...ful().data, shipment_status: "picked_up" } }), NOW)
    expect(again).toMatchObject({ skip: false, ship: false, deliver: false })
  })

  it("delivers, shipping first when the pickup was missed", () => {
    expect(planGhnSync(snap("delivered", "delivered"), ful(), NOW)).toMatchObject({ ship: true, deliver: true })
    expect(planGhnSync(snap("delivered", "delivered"), ful({ shipped_at: NOW }), NOW)).toMatchObject({ ship: false, deliver: true })
    const done = ful({ shipped_at: NOW, delivered_at: NOW, data: { ...ful().data, shipment_status: "delivered" } })
    expect(planGhnSync(snap("delivered", "delivered"), done, NOW)).toMatchObject({ skip: true })
  })

  it("never moves back from a final status, flags problems", () => {
    const delivered = ful({ shipped_at: NOW, delivered_at: NOW, data: { ...ful().data, shipment_status: "delivered" } })
    expect(planGhnSync(snap("returning", "returning"), delivered, NOW)).toMatchObject({ skip: true })
    const lost = planGhnSync(snap("lost", "lost"), ful({ shipped_at: NOW, data: { ...ful().data, shipment_status: "in_transit" } }), NOW)
    expect(lost).toMatchObject({ skip: false, flag: true, ship: false })
    expect(lost.data).toMatchObject({ shipment_flag: "lost", shipment_status: "lost" })
  })

  it("records the COD transfer date even without a status change", () => {
    const f = ful({ shipped_at: NOW, delivered_at: NOW, data: { ...ful().data, shipment_status: "delivered" } })
    const plan = planGhnSync(snap("delivered", "delivered", { cod_transfer_date: "2026-11-12T03:00:00Z" }), f, NOW)
    expect(plan).toMatchObject({ skip: false, ship: false, deliver: false })
    expect(plan.data).toMatchObject({ ghn_cod_transfer_date: "2026-11-12T03:00:00Z", shipment_status: "delivered" })
  })

  it("does not touch an order it cannot identify", () => {
    expect(planGhnSync(snap("picked", "picked_up"), ful({ order_id: undefined }), NOW)).toMatchObject({ skip: true, reason: "fulfillment has no order_id" })
  })
})

describe("codAmountForOrder", () => {
  it("collects the total only for COD payments", () => {
    expect(codAmountForOrder({ total: 450000.4, payment_collections: [{ payments: [{ provider_id: "pp_cod_cod" }] }] })).toBe(450000)
    expect(codAmountForOrder({ total: { numeric: 320000 }, payment_collections: [{ payments: [{ provider_id: "pp_cod_cod" }] }] })).toBe(320000)
    expect(codAmountForOrder({ total: 450000, payment_collections: [{ payments: [{ provider_id: "pp_vnpay_vnpay" }] }] })).toBe(0)
  })

  it("ignores sessions of a method the customer switched away from", () => {
    const order = {
      total: 450000,
      payment_collections: [
        {
          payments: [{ provider_id: "pp_sepay_sepay" }],
          payment_sessions: [{ provider_id: "pp_cod_cod", status: "pending" }, { provider_id: "pp_sepay_sepay", status: "authorized" }],
        },
      ],
    }
    expect(codAmountForOrder(order)).toBe(0)
    expect(codAmountForOrder({ total: 100000, payment_collections: [{ payment_sessions: [{ provider_id: "pp_cod_cod", status: "authorized" }] }] })).toBe(100000)
    expect(codAmountForOrder({ total: 100000 })).toBe(0)
  })
})

describe("ghnRuntimeFrom", () => {
  const container = (modules: unknown) => ({ resolve: () => ({ modules }) }) as any
  const ghn = { resolve: "@teknixglobal/medusa-fulfillment-ghn/providers/ghn", id: "ghn", options: { env: "staging", token: "t", shop_id: "236959", webhook_secret: "s" } }

  it("finds the GHN provider in array or keyed module config", () => {
    const fromArray = ghnRuntimeFrom(container([{ resolve: "@medusajs/medusa/fulfillment", options: { providers: [{ resolve: "x", id: "manual" }, ghn] } }]))
    expect(fromArray?.provider_id).toBe("ghn_ghn")
    expect(fromArray?.adapter.verifyWebhook({ "x-teknix-webhook-secret": "s" }, { ShopID: 236959 })).toBe(true)
    const keyed = ghnRuntimeFrom(container({ fulfillment: { options: { providers: [{ ...ghn, id: "ghn-hn" }] } } }))
    expect(keyed?.provider_id).toBe("ghn_ghn-hn")
  })

  it("returns null when GHN is not configured", () => {
    expect(ghnRuntimeFrom(container([{ resolve: "@medusajs/medusa/payment", options: { providers: [] } }]))).toBeNull()
    expect(ghnRuntimeFrom(container(undefined))).toBeNull()
  })
})

describe("store vn-address routes", () => {
  const { GET: provinces } = require("../api/store/vn-address/provinces/route")
  const { GET: wards } = require("../api/store/vn-address/provinces/[code]/wards/route")
  const res = () => {
    const r: any = { headers: {}, body: undefined }
    r.setHeader = (k: string, v: string) => (r.headers[k] = v)
    r.json = (b: unknown) => (r.body = b)
    return r
  }

  it("lists provinces and wards, 404 for unknown provinces", async () => {
    const r1 = res()
    await provinces({} as any, r1)
    expect(r1.body.provinces).toHaveLength(34)
    expect(r1.body.provinces[0]).toEqual({ code: "01", name: "Hà Nội", full_name: "Thành phố Hà Nội" })
    expect(r1.headers["Cache-Control"]).toContain("max-age=86400")
    const r2 = res()
    await wards({ params: { code: "01" } } as any, r2)
    expect(r2.body.wards.find((w: any) => w.code === "00004")).toEqual({ code: "00004", name: "Ba Đình", full_name: "Phường Ba Đình", postal_code: "11120" })
    await expect(wards({ params: { code: "99" } } as any, res())).rejects.toThrow(/not found/)
  })
})

describe("planGhnSync reasons", () => {
  const base = { id: "ful_1", order_id: "order_1", data: { ghn_order_code: "X", shipment_status: "out_for_delivery" }, items: [], shipped_at: NOW }
  it("keeps the webhook reason only when GHN confirms the same status", () => {
    const s = { carrier_order_code: "X", reference: "ful_1", raw_status: "delivery_fail", status: "delivery_failed" as const }
    const confirmed = planGhnSync(s, base as any, NOW, { reason: "Khách không nghe máy", reason_code: "GHN-DFC1A4", raw_status: "delivery_fail" })
    expect(confirmed.data).toMatchObject({ ghn_reason: "Khách không nghe máy", ghn_reason_code: "GHN-DFC1A4", shipment_flag: "delivery_failed" })
    const forged = planGhnSync(s, base as any, NOW, { reason: "x", raw_status: "delivered" })
    expect(forged.data?.ghn_reason).toBeUndefined()
  })
})

describe("planCodCapture", () => {
  const GHN = "ghn_ghn"
  const delivered = (extra: Record<string, unknown> = {}) => ({
    id: "ful_1",
    provider_id: GHN,
    delivered_at: NOW,
    data: { order_id: "order_1", shipment_status: "delivered", ghn_cod_amount: 450000 },
    ...extra,
  })
  const order = (extra: Record<string, unknown> = {}, payment: Record<string, unknown> = {}) => ({
    id: "order_1",
    fulfillments: [delivered()],
    payment_collections: [{ payments: [{ id: "pay_1", provider_id: "pp_cod_cod", amount: 450000, captures: [], ...payment }] }],
    ...extra,
  })

  it("captures the remaining COD once GHN reported the delivery", () => {
    expect(planCodCapture(delivered(), order(), GHN)).toEqual({ action: "capture", payment_id: "pay_1", amount: 450000 })
    expect(planCodCapture(delivered(), order({}, { amount: { numeric: 450000 } }), GHN)).toMatchObject({ action: "capture" })
  })

  it("skips other carriers, prepaid orders and captured payments", () => {
    expect(planCodCapture(delivered({ provider_id: "manual_manual" }), order(), GHN)).toMatchObject({ action: "skip" })
    expect(planCodCapture(delivered(), order({}, { provider_id: "pp_vnpay_vnpay" }), GHN)).toMatchObject({ action: "skip", reason: "no COD payment" })
    expect(planCodCapture(delivered(), order({}, { captured_at: NOW }), GHN)).toMatchObject({ action: "skip", reason: "COD already captured" })
    expect(planCodCapture(delivered(), order({}, { captures: [{ amount: 450000 }] }), GHN)).toMatchObject({ action: "skip" })
    expect(planCodCapture(delivered(), order({}, { canceled_at: NOW }), GHN)).toMatchObject({ action: "skip" })
  })

  it("blocks a delivery GHN did not report (manual mark as delivered)", () => {
    const manual = delivered({ data: { order_id: "order_1", shipment_status: "in_transit", ghn_cod_amount: 450000 } })
    expect(planCodCapture(manual, order({ fulfillments: [manual] }), GHN)).toMatchObject({ action: "block" })
  })

  it("waits for every live shipment, ignores cancelled ones", () => {
    const second = { id: "ful_2", provider_id: GHN, delivered_at: null, data: { ghn_cod_amount: 0 } }
    expect(planCodCapture(delivered(), order({ fulfillments: [delivered(), second] }), GHN)).toMatchObject({ action: "skip" })
    const cancelled = { ...second, canceled_at: NOW, data: { ghn_cod_amount: 450000 } }
    expect(planCodCapture(delivered(), order({ fulfillments: [delivered(), cancelled] }), GHN)).toMatchObject({ action: "capture" })
  })

  it("blocks when the COD GHN collects differs from the payment", () => {
    const split = { id: "ful_2", provider_id: GHN, delivered_at: NOW, data: { ghn_cod_amount: 450000 } }
    expect(planCodCapture(delivered(), order({ fulfillments: [delivered(), split] }), GHN)).toMatchObject({
      action: "block",
      reason: "GHN collects 900000 VND, COD payment is 450000 VND",
    })
    expect(planCodCapture(delivered(), order({}, { amount: 500000 }), GHN)).toMatchObject({ action: "block" })
    const edited = delivered({ data: { order_id: "order_1", shipment_status: "delivered", ghn_cod_amount: 450000, ghn_cod_reported: 300000 } })
    expect(planCodCapture(edited, order({ fulfillments: [edited] }), GHN)).toMatchObject({ action: "block", reason: expect.stringContaining("GHN reports COD 300000") })
  })

  it("records the COD GHN reports on every sync", () => {
    expect(planGhnSync(snap("delivered", "delivered", { cod_amount: 450000 }), ful(), NOW).data).toMatchObject({ ghn_cod_reported: 450000 })
  })
})
