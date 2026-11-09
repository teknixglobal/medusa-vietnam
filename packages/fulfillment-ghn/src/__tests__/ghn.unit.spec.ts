import { MedusaError } from "@medusajs/framework/utils"
import {
  buildVnAddress,
  CarrierError,
  listVnProvinces,
  listVnWards,
  VN_COD_METADATA_KEY,
} from "@teknixglobal/medusa-vietnam-shipping-core"
import { GhnAdapter } from "../lib/adapter"
import { ghnPlaceFor, GHN_MAP_INFO } from "../lib/address-map"
import { GhnClient, parseGhnJson } from "../lib/client"
import { ghnStatus } from "../lib/status"
import GhnFulfillmentService from "../providers/ghn/service"

const HN = "01"
const HOAN_KIEM = listVnWards(HN).find((w) => w.name === "Hoàn Kiếm")!.code
const BA_DINH = "00004"
const HCM = "79"
const SAI_GON = listVnWards(HCM).find((w) => w.name === "Sài Gòn")!.code

const pickup = {
  name: "Kho Teknix",
  phone: "+84 921 947 034",
  address_line: "1 Đinh Tiên Hoàng",
  province_code: HN,
  ward_code: HOAN_KIEM,
}

type Call = { url: string; body: any; headers: Record<string, string> }

/** fetch stub: answers by path suffix, records calls. */
function stubFetch(routes: Record<string, (body: any) => { status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = []
  const fn = jest.fn(async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url, body, headers: init?.headers })
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) throw new Error(`unexpected ${url}`)
    const r = routes[key](body)
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => r.text ?? JSON.stringify(r.json),
    } as Response
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const ok = (data: unknown) => ({ json: { code: 200, message: "Success", data } })

function adapter(routes: Parameters<typeof stubFetch>[0], extra: Record<string, unknown> = {}) {
  const stub = stubFetch(routes)
  const client = new GhnClient({ env: "staging", token: "tok", shop_id: 236959, fetch: stub.fetch })
  const a = new GhnAdapter(
    { env: "staging", token: "tok", shop_id: 236959, pickup: { ...pickup, phone: "0921947034" }, webhook_secret: "s3cret", ...extra },
    client
  )
  return { a, calls: stub.calls }
}

const parcel = { weight_g: 1200, length_cm: 30, width_cm: 20, height_cm: 10 }

describe("address map", () => {
  it("covers every 2025 province and ward", () => {
    expect(GHN_MAP_INFO.vn_units_version).toBe("v5.2.0")
    for (const p of listVnProvinces()) {
      for (const w of listVnWards(p.code)) {
        expect(() => ghnPlaceFor({ province_code: p.code, ward_code: w.code })).not.toThrow()
      }
    }
    expect(ghnPlaceFor({ province_code: HCM, ward_code: SAI_GON })).toMatchObject({
      province_name: "Hồ Chí Minh",
      ward_name: "Phường Sài Gòn",
    })
  })

  it("rejects unknown or mismatched codes", () => {
    expect(() => ghnPlaceFor({ province_code: HN, ward_code: SAI_GON })).toThrow(/INVALID_ADDRESS/)
    expect(() => ghnPlaceFor({ province_code: "99", ward_code: "00000" })).toThrow(CarrierError)
  })
})

describe("client", () => {
  it("parses GHN JSON with raw control characters", () => {
    expect(parseGhnJson<{ a: string }>('{"a":"x\ty\nz"}').a).toBe("x y z")
  })

  it("sends Token and ShopId, maps errors", async () => {
    const { a, calls } = adapter({
      "/preview": () => ({ status: 400, json: { code: 400, code_message: "COD_IS_OVER_LIMIT", message: "Giá trị COD vượt mức" } }),
    })
    await expect(
      a.client.preview({} as any)
    ).rejects.toMatchObject({ code: "COD_TOO_HIGH", retryable: false })
    expect(calls[0].headers).toMatchObject({ Token: "tok", ShopId: "236959" })
    expect(calls[0].url).toBe("https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/preview")
  })

  it("treats 401 and 5xx as unauthorized / retryable", async () => {
    const { a } = adapter({
      "/detail": () => ({ status: 401, json: { code: 401, message: "Token is not valid!" } }),
      "/a5/gen-token": () => ({ status: 502, text: "<html>bad gateway</html>" }),
    })
    await expect(a.client.detail("X")).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    await expect(a.client.printToken(["X"])).rejects.toMatchObject({ code: "CARRIER_UNAVAILABLE", retryable: true })
  })
})

describe("adapter", () => {
  it("quotes with preview, GHN names, new-address flags and placeholders", async () => {
    const { a, calls } = adapter({
      "/preview": () => ok({ order_code: "", total_fee: 39000, expected_delivery_time: "2026-11-11T16:59:59Z" }),
    })
    const quote = await a.quote({ service: "2", to: { province_code: HCM, ward_code: SAI_GON }, parcel, cod_amount: 0 })
    expect(quote).toEqual({ amount: 39000, service: "2", eta: { to: "2026-11-11T16:59:59Z" } })
    const body = calls[0].body
    expect(body).toMatchObject({
      service_type_id: 2,
      to_ward_name: "Phường Sài Gòn",
      to_province_name: "Hồ Chí Minh",
      is_new_to_address: true,
      from_ward_name: "Phường Hoàn Kiếm",
      from_province_name: "Hà Nội",
      is_new_from_address: true,
      to_name: "Khach hang",
      to_phone: "0921947034",
      to_address: "-",
      payment_type_id: 1,
      weight: 1200,
    })
    expect(body.client_order_code).toBeUndefined()
  })

  it("creates with client_order_code and returns tracking info", async () => {
    const { a, calls } = adapter({
      "/create": () => ok({ order_code: "LYGF7F", total_fee: 70400, expected_delivery_time: "2026-11-12T16:59:59Z", sort_code: "2x31" }),
    })
    const shipment = await a.createShipment({
      reference: "ful_01TEST",
      service: "2",
      to: { province_code: HCM, ward_code: SAI_GON, name: "Khách", phone: "0900000000", address_line: "12 Lê Lợi" },
      parcel,
      cod_amount: 200000,
      items: [{ name: "Áo", quantity: 1 }],
    })
    expect(shipment).toMatchObject({
      carrier_order_code: "LYGF7F",
      fee: 70400,
      tracking_url: "https://donhang.ghn.vn/?order_code=LYGF7F",
    })
    expect(calls[0].body).toMatchObject({ client_order_code: "ful_01TEST", cod_amount: 200000, to_phone: "0900000000" })
  })

  it("checks limits before calling GHN", async () => {
    const { a, calls } = adapter({}, { cod_max: 300000 })
    await expect(
      a.quote({ service: "2", to: { province_code: HCM, ward_code: SAI_GON }, parcel, cod_amount: 400000 })
    ).rejects.toMatchObject({ code: "COD_TOO_HIGH" })
    await expect(
      a.quote({ service: "2", to: { province_code: HCM, ward_code: SAI_GON }, parcel: { ...parcel, weight_g: 60000 }, cod_amount: 0 })
    ).rejects.toMatchObject({ code: "PARCEL_TOO_LARGE" })
    expect(calls).toHaveLength(0)
  })

  it("fails cancel/return when GHN answers 200 with result false", async () => {
    const { a } = adapter({
      "/switch-status/cancel": (b) => ok([{ order_code: b.order_codes[0], result: true, message: "OK" }]),
      "/switch-status/return": (b) => ok([{ order_code: b.order_codes[0], result: false, message: "Trạng thái đơn hàng không hợp lệ" }]),
    })
    await expect(a.cancelShipment("LYGF7F")).resolves.toBeUndefined()
    await expect(a.createReturn("LYGF7F")).rejects.toThrow(/không hợp lệ/)
  })

  it("maps detail to a snapshot and builds label URLs", async () => {
    const { a } = adapter({
      "/shipping-order/detail": () => ok({ order_code: "LYGF7F", client_order_code: "ful_1", status: "delivering", cod_amount: 200000 }),
      "/a5/gen-token": () => ok({ token: "abc" }),
    })
    await expect(a.getShipment("LYGF7F")).resolves.toMatchObject({ status: "out_for_delivery", raw_status: "delivering", reference: "ful_1" })
    await expect(a.getLabelUrl(["LYGF7F"], "80x80")).resolves.toBe("https://dev-online-gateway.ghn.vn/a5/public-api/print80x80?token=abc")
  })

  it("verifies and parses webhooks", () => {
    const { a } = adapter({})
    const body = { ShopID: 236959, OrderCode: "LYGF7F", ClientOrderCode: "ful_1", Type: "switch_status", Status: "delivered", Time: "2026-07-15T04:49:47.811Z" }
    expect(a.verifyWebhook({ "x-teknix-webhook-secret": "s3cret" }, body)).toBe(true)
    expect(a.verifyWebhook({ "x-teknix-webhook-secret": "nope" }, body)).toBe(false)
    expect(a.verifyWebhook({ "x-teknix-webhook-secret": "s3cret" }, { ...body, ShopID: 1 })).toBe(false)
    expect(a.parseWebhook(body)).toEqual([
      {
        carrier_order_code: "LYGF7F",
        reference: "ful_1",
        type: "switch_status",
        raw_status: "delivered",
        status: "delivered",
        occurred_at: "2026-07-15T04:49:47.811Z",
        dedupe_key: "ghn:LYGF7F:switch_status:2026-07-15T04:49:47.811Z",
        account_id: "236959",
      },
    ])
    expect(() => a.parseWebhook({})).toThrow(CarrierError)
  })

  it("maps every documented GHN status", () => {
    expect(ghnStatus("ready_to_pick")).toBe("pending")
    expect(ghnStatus("picked")).toBe("picked_up")
    expect(ghnStatus("returned")).toBe("returned")
    expect(ghnStatus("damage")).toBe("lost")
    expect(ghnStatus("something_new")).toBe("unknown")
  })
})

describe("provider", () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() } as any
  const base = { env: "staging", token: "tok", shop_id: 236959, pickup }

  function provider(extra: Record<string, unknown> = {}, routes: Parameters<typeof stubFetch>[0] = {}) {
    const service = new GhnFulfillmentService({ logger }, { ...base, ...extra } as any)
    const stub = stubFetch(routes)
    ;(service.adapter.client as any).fetchImpl = stub.fetch
    return { service, calls: stub.calls }
  }

  const vnAddress = (province: string, ward: string, extra: Record<string, unknown> = {}) => {
    const built = buildVnAddress(province, ward)
    return { first_name: "Nguyễn", last_name: "An", phone: "0912 345 678", address_1: "12 Lê Lợi", province: built.province, city: built.city, metadata: built.metadata, ...extra }
  }

  it("validates options", () => {
    expect(() => GhnFulfillmentService.validateOptions({ ...base })).not.toThrow()
    expect(() => GhnFulfillmentService.validateOptions({ ...base, env: "sandbox" })).toThrow(MedusaError)
    expect(() => GhnFulfillmentService.validateOptions({ ...base, token: "" })).toThrow(/token/)
    expect(() => GhnFulfillmentService.validateOptions({ ...base, shop_id: "x" })).toThrow(/shop_id/)
    expect(() => GhnFulfillmentService.validateOptions({ ...base, pickup: { ...pickup, ward_code: SAI_GON } })).toThrow(/pickup/)
  })

  it("exposes options and validates them", async () => {
    const { service } = provider()
    const options = await service.getFulfillmentOptions()
    expect(options.map((o) => o.id)).toEqual(["ghn-standard", "ghn-heavy", "ghn-return"])
    expect(await service.validateOption({ id: "ghn-heavy" })).toBe(true)
    expect(await service.validateOption({ id: "x" })).toBe(false)
    expect(await service.canCalculate({} as any)).toBe(true)
  })

  it("asks for a 2025 address before shipping", async () => {
    const { service } = provider()
    await expect(
      service.validateFulfillmentData({ id: "ghn-standard" }, {}, { shipping_address: { address_1: "x" } } as any)
    ).rejects.toThrow(/Phường\/Xã/)
    await expect(
      service.validateFulfillmentData({ id: "ghn-heavy", service_type_id: 5 }, {}, { shipping_address: vnAddress(HCM, SAI_GON) } as any)
    ).resolves.toEqual({ service_type_id: 5 })
  })

  it("calculates price from cart items, caches it, falls back when GHN fails", async () => {
    let fail = false
    const { service, calls } = provider({ fallback_amount: 30000 }, {
      "/preview": () => (fail ? { status: 500, json: { code: 500, message: "down" } } : ok({ order_code: "", total_fee: 39000 })),
    })
    const context = {
      shipping_address: vnAddress(HCM, SAI_GON),
      items: [{ quantity: 2, variant: { weight: 300, length: 30, width: 20, height: 5 } }],
    } as any
    const price = await service.calculatePrice({ id: "ghn-standard" }, {}, context)
    expect(price).toEqual({ calculated_amount: 39000, is_calculated_price_tax_inclusive: true })
    expect(calls[0].body).toMatchObject({ weight: 600, to_name: "Nguyễn An", to_phone: "0912345678", to_address: "12 Lê Lợi", cod_amount: 0 })
    await service.calculatePrice({ id: "ghn-standard" }, {}, context)
    expect(calls).toHaveLength(1)

    fail = true
    const other = { ...context, shipping_address: vnAddress(HN, BA_DINH) }
    await expect(service.calculatePrice({ id: "ghn-standard" }, {}, other)).resolves.toMatchObject({ calculated_amount: 30000 })
    expect(logger.warn).toHaveBeenCalled()
    await expect(
      service.calculatePrice({ id: "ghn-standard" }, {}, { ...context, shipping_address: { address_1: "x" } })
    ).resolves.toMatchObject({ calculated_amount: 30000 })
  })

  it("blocks checkout when there is no fallback", async () => {
    const { service } = provider({}, { "/preview": () => ({ status: 500, json: { code: 500, message: "down" } }) })
    await expect(
      service.calculatePrice({ id: "ghn-standard" }, {}, { shipping_address: vnAddress(HCM, SAI_GON), items: [] } as any)
    ).rejects.toThrow(MedusaError)
  })

  it("creates a fulfillment with COD from order metadata and parcel from order variants", async () => {
    const { service, calls } = provider({}, {
      "/create": () => ok({ order_code: "LYGF7F", total_fee: 70400, expected_delivery_time: "2026-11-12T16:59:59Z" }),
    })
    const result = await service.createFulfillment(
      { service_type_id: 2 },
      [{ line_item_id: "li_1", quantity: 2, title: "Áo thi đấu" } as any],
      {
        display_id: 18,
        metadata: { [VN_COD_METADATA_KEY]: 450000 },
        shipping_address: vnAddress(HCM, SAI_GON),
        items: [{ id: "li_1", variant: { weight: 250 } }],
      } as any,
      { id: "ful_01TEST" } as any
    )
    expect(calls[0].body).toMatchObject({
      client_order_code: "ful_01TEST",
      cod_amount: 450000,
      weight: 500,
      to_phone: "0912345678",
      content: "Don hang #18",
      items: [{ name: "Áo thi đấu", quantity: 2 }],
    })
    expect(result.labels).toEqual([
      { tracking_number: "LYGF7F", tracking_url: "https://donhang.ghn.vn/?order_code=LYGF7F", label_url: "" },
    ])
    expect(result.data).toMatchObject({ ghn_order_code: "LYGF7F", ghn_cod_amount: 450000, ghn_env: "staging" })
  })

  it("refuses to create without a valid phone", async () => {
    const { service, calls } = provider()
    await expect(
      service.createFulfillment({}, [], { shipping_address: vnAddress(HCM, SAI_GON, { phone: "123" }) } as any, { id: "ful_1" } as any)
    ).rejects.toThrow(/điện thoại/)
    expect(calls).toHaveLength(0)
  })

  it("cancels, records returns, fetches fresh labels", async () => {
    const { service } = provider({}, {
      "/switch-status/cancel": (b) => ok([{ order_code: b.order_codes[0], result: true }]),
      "/a5/gen-token": () => ok({ token: "t1" }),
    })
    await expect(service.cancelFulfillment({ ghn_order_code: "LYGF7F" })).resolves.toMatchObject({ ghn_status: "cancel" })
    await expect(service.cancelFulfillment({})).resolves.toEqual({})
    await expect(service.createReturnFulfillment({} as any)).resolves.toEqual({ data: { ghn_return: "manual" }, labels: [] })
    await expect(service.retrieveDocuments({ ghn_order_code: "LYGF7F" }, "label")).resolves.toEqual([
      { type: "label", url: "https://dev-online-gateway.ghn.vn/a5/public-api/printA5?token=t1" },
    ])
    await expect(service.retrieveDocuments({ ghn_order_code: "LYGF7F" }, "invoice")).resolves.toEqual([])
  })
})
