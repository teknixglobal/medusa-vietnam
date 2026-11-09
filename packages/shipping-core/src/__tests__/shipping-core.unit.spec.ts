import {
  actionForStatus,
  assertWithinCapabilities,
  buildParcel,
  buildVnAddress,
  canTransition,
  CarrierError,
  createStatusMapper,
  getVnWard,
  headerValue,
  isFinalStatus,
  listVnProvinces,
  listVnWards,
  matchVnWard,
  MemoryTtlCache,
  normalizeVnName,
  normalizeVnPhone,
  quoteCacheKey,
  quoteWithFallback,
  readVnAddress,
  toShippingAmount,
  verifySharedSecretHeader,
  VN_UNITS_DATASET,
  WebhookDeduper,
  type CarrierCapabilities,
  type QuoteRequest,
} from ".."

const HN = "01"
const BA_DINH = "00004"

const caps: CarrierCapabilities = {
  labels: true,
  returns: true,
  cod_max: 50_000_000,
  requires_geo: false,
  max_weight_g: 50_000,
  max_side_cm: 200,
}

const request = (over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  service: "2",
  to: { province_code: HN, ward_code: BA_DINH },
  parcel: { weight_g: 1234, length_cm: 30, width_cm: 20, height_cm: 10 },
  cod_amount: 450_000,
  ...over,
})

describe("vn units dataset", () => {
  it("has the 2025 map: 34 provinces, 3321 wards, every ward in a province", () => {
    expect(VN_UNITS_DATASET.version).toBe("v5.2.0")
    expect(listVnProvinces()).toHaveLength(34)
    const total = listVnProvinces().reduce((n, p) => n + listVnWards(p.code).length, 0)
    expect(total).toBe(3321)
    expect(getVnWard(BA_DINH)).toMatchObject({ province_code: HN, full_name: "Phường Ba Đình" })
  })
})

describe("address", () => {
  it("builds and reads metadata.vn_address", () => {
    const built = buildVnAddress(HN, BA_DINH)
    expect(built.province).toBe("Thành phố Hà Nội")
    expect(built.city).toBe("Phường Ba Đình")
    expect(built.postal_code).toBe("11120")
    const read = readVnAddress({ metadata: built.metadata })
    expect(read).toMatchObject({ scheme: "2025", province_code: HN, ward_code: BA_DINH })
    expect(read?.ward.name).toBe("Ba Đình")
  })

  it("rejects a ward from another province and old/missing data", () => {
    const hcmWard = listVnWards("79")[0]
    expect(() => buildVnAddress(HN, hcmWard.code)).toThrow()
    expect(readVnAddress({ metadata: { vn_address: { scheme: "2025", province_code: HN, ward_code: hcmWard.code } } })).toBeNull()
    expect(readVnAddress({ metadata: { vn_address: { scheme: "2019", province_code: HN, ward_code: BA_DINH } } })).toBeNull()
    expect(readVnAddress({ metadata: null })).toBeNull()
    expect(readVnAddress(undefined)).toBeNull()
  })

  it("keeps a valid geo point and drops a bad one", () => {
    const geo = { lat: 21.0341, lng: 105.8372 }
    expect(readVnAddress({ metadata: buildVnAddress(HN, BA_DINH, geo).metadata })?.geo).toEqual(geo)
    expect(() => buildVnAddress(HN, BA_DINH, { lat: 200, lng: 0 })).toThrow()
    const raw = { metadata: { vn_address: { scheme: "2025", province_code: HN, ward_code: BA_DINH, geo: { lat: "x" } } } }
    expect(readVnAddress(raw)?.geo).toBeUndefined()
  })

  it("normalizes names", () => {
    expect(normalizeVnName("Phường Đống Đa")).toBe("dong da")
    expect(normalizeVnName("  Thành phố  Hồ Chí Minh ")).toBe("ho chi minh")
    expect(normalizeVnName("Phường 01")).toBe("1")
  })

  it("matches wards without guessing between names that differ only by accents", () => {
    expect(matchVnWard(HN, ["Phường Ba Đình"])?.code).toBe(BA_DINH)
    expect(matchVnWard(HN, ["ba dinh"])?.code).toBe(BA_DINH)
    expect(matchVnWard(HN, ["nowhere", "Ba Đình"])?.code).toBe(BA_DINH)
    // Thái Nguyên has both "Xã Văn Lang" and "Xã Văn Lăng".
    const tn = listVnProvinces().find((p) => p.name === "Thái Nguyên")!.code
    expect(matchVnWard(tn, ["Xã Văn Lăng"])?.full_name).toBe("Xã Văn Lăng")
    expect(matchVnWard(tn, ["Văn Lang"])?.full_name).toBe("Xã Văn Lang")
    expect(matchVnWard(tn, ["van lang"])).toBeUndefined()
    expect(matchVnWard(HN, [])).toBeUndefined()
  })
})

describe("phone", () => {
  it.each([
    ["0912 345 678", "0912345678"],
    ["+84 912.345.678", "0912345678"],
    ["84912345678", "0912345678"],
    ["(028) 3822-1234", "02838221234"],
    ["+84 28 3822 1234", "02838221234"],
    ["091234567", null],
    ["0012345678", null],
    [undefined, null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeVnPhone(input as string | undefined)).toBe(expected)
  })
})

describe("parcel", () => {
  it("adds weights, stacks heights, applies defaults and minimum sides", () => {
    const parcel = buildParcel(
      [
        { quantity: 2, weight: 300, length: 30, width: 20, height: 5 },
        { quantity: "1", weight: null },
      ],
      { packaging_weight_g: 100 }
    )
    expect(parcel).toEqual({ weight_g: 2 * 300 + 500 + 100, length_cm: 30, width_cm: 20, height_cm: 10 })
  })

  it("converts kg and mm", () => {
    const parcel = buildParcel([{ quantity: 1, weight: 1.25, length: 355, width: 101, height: 99 }], {
      weight_unit: "kg",
      dimension_unit: "mm",
    })
    expect(parcel).toEqual({ weight_g: 1250, length_cm: 36, width_cm: 11, height_cm: 10 })
  })

  it("checks carrier limits", () => {
    const ok = { weight_g: 1000, length_cm: 10, width_cm: 10, height_cm: 10 }
    expect(() => assertWithinCapabilities("ghn", caps, ok, 1_000_000)).not.toThrow()
    expect(() => assertWithinCapabilities("ghn", caps, { ...ok, weight_g: 60_000 })).toThrow(/PARCEL_TOO_LARGE/)
    expect(() => assertWithinCapabilities("ghn", caps, { ...ok, height_cm: 201 })).toThrow(/PARCEL_TOO_LARGE/)
    expect(() => assertWithinCapabilities("ghn", caps, ok, 60_000_000)).toThrow(/COD_TOO_HIGH/)
  })
})

describe("status", () => {
  const map = createStatusMapper({ Delivered: "delivered", picking: "pending", picked: "picked_up" })

  it("maps raw codes case-insensitively, unknown otherwise", () => {
    expect(map("delivered")).toBe("delivered")
    expect(map(" PICKED ")).toBe("picked_up")
    expect(map("weird")).toBe("unknown")
    expect(map(undefined)).toBe("unknown")
  })

  it("knows final statuses and the Medusa action", () => {
    expect(isFinalStatus("delivered")).toBe(true)
    expect(isFinalStatus("in_transit")).toBe(false)
    expect(actionForStatus("picked_up")).toBe("mark_shipped")
    expect(actionForStatus("delivered")).toBe("mark_delivered")
    expect(actionForStatus("lost")).toBe("flag")
    expect(actionForStatus("pending")).toBe("none")
  })

  it("never leaves a final status, except exception", () => {
    expect(canTransition(undefined, "pending")).toBe(true)
    expect(canTransition("pending", "in_transit")).toBe(true)
    expect(canTransition("in_transit", "in_transit")).toBe(false)
    expect(canTransition("delivered", "returning")).toBe(false)
    expect(canTransition("exception", "delivered")).toBe(true)
    expect(canTransition("exception", "pending")).toBe(false)
    expect(canTransition("in_transit", "unknown")).toBe(false)
  })
})

describe("price", () => {
  it("rounds amounts and rejects bad ones", () => {
    expect(toShippingAmount(32000)).toBe(32000)
    expect(toShippingAmount("32000.2")).toBe(32001)
    expect(toShippingAmount(0)).toBe(0)
    expect(() => toShippingAmount(-1)).toThrow()
    expect(() => toShippingAmount("abc")).toThrow()
  })

  it("buckets cache keys by 100 g and 100 000 VND COD", () => {
    const a = quoteCacheKey("ghn", request({ parcel: { weight_g: 1201, length_cm: 30, width_cm: 20, height_cm: 10 } }))
    const b = quoteCacheKey("ghn", request({ parcel: { weight_g: 1290, length_cm: 30, width_cm: 20, height_cm: 10 } }))
    const c = quoteCacheKey("ghn", request({ cod_amount: 550_000 }))
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it("uses cache, then carrier, then fallback", async () => {
    const cache = new MemoryTtlCache()
    const fetchQuote = jest.fn().mockResolvedValue({ amount: 31500.4, service: "2" })
    const first = await quoteWithFallback(request(), fetchQuote, { carrier: "ghn", cache, fallback_amount: 30000 })
    expect(first).toMatchObject({ amount: 31501, source: "carrier" })
    const second = await quoteWithFallback(request(), fetchQuote, { carrier: "ghn", cache, fallback_amount: 30000 })
    expect(second).toMatchObject({ amount: 31501, source: "cache" })
    expect(fetchQuote).toHaveBeenCalledTimes(1)

    const failing = jest.fn().mockRejectedValue(new CarrierError("ghn", "CARRIER_UNAVAILABLE", "down"))
    const third = await quoteWithFallback(request({ cod_amount: 0 }), failing, { carrier: "ghn", fallback_amount: 30000 })
    expect(third.source).toBe("fallback")
    expect(third.amount).toBe(30000)
    await expect(quoteWithFallback(request(), failing, { carrier: "ghn" })).rejects.toThrow(/CARRIER_UNAVAILABLE/)
  })

  it("falls back on timeout", async () => {
    const slow = () => new Promise<never>(() => undefined)
    const result = await quoteWithFallback(request(), slow, { carrier: "ghn", timeout_ms: 10, fallback_amount: 25000 })
    expect(result.source).toBe("fallback")
    expect((result.error as CarrierError).code).toBe("TIMEOUT")
    expect((result.error as CarrierError).retryable).toBe(true)
  })
})

describe("cache", () => {
  it("expires entries and caps size", async () => {
    let now = 0
    const cache = new MemoryTtlCache(2, () => now)
    await cache.set("a", 1, 10)
    await cache.set("b", 2, 10)
    await cache.set("c", 3, 10)
    expect(await cache.get("a")).toBeUndefined()
    expect(await cache.get("c")).toBe(3)
    now = 11_000
    expect(await cache.get("c")).toBeUndefined()
  })
})

describe("webhook", () => {
  it("checks the shared secret header case-insensitively in constant time", () => {
    expect(headerValue({ "X-Shop-Secret": ["s1", "s2"] }, "x-shop-secret")).toBe("s1")
    expect(verifySharedSecretHeader({ "x-shop-secret": "abc" }, "X-Shop-Secret", "abc")).toBe(true)
    expect(verifySharedSecretHeader({ "x-shop-secret": "abd" }, "X-Shop-Secret", "abc")).toBe(false)
    expect(verifySharedSecretHeader({}, "X-Shop-Secret", "abc")).toBe(false)
    expect(verifySharedSecretHeader({ "x-shop-secret": "" }, "X-Shop-Secret", "")).toBe(false)
  })

  it("skips events only after they were handled", async () => {
    const dedupe = new WebhookDeduper()
    expect(await dedupe.seen("GHN1:switch_status:t1")).toBe(false)
    expect(await dedupe.seen("GHN1:switch_status:t1")).toBe(false)
    await dedupe.remember("GHN1:switch_status:t1")
    expect(await dedupe.seen("GHN1:switch_status:t1")).toBe(true)
  })
})
