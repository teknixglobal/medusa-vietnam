import { codeFromProviderId, pickLocale } from "../i18n"
import { redact } from "../redact"
import { parseOrigins, resolveReturnUrl } from "../return-url"
import { safeEqual } from "../crypto"
import { toVndInteger } from "../amount"

describe("lib", () => {
  it("parses origins like STORE_CORS", () => {
    expect(parseOrigins("http://localhost:8000, https://a.test/path,/regex/")).toEqual([
      "http://localhost:8000",
      "https://a.test",
    ])
  })

  it("resolves return urls", () => {
    expect(resolveReturnUrl(undefined, [], "https://x.test/r")).toBe("https://x.test/r")
    expect(() => resolveReturnUrl("javascript:alert(1)", ["https://x.test"])).toThrow()
    expect(() => resolveReturnUrl(undefined, [])).toThrow(/Missing return_url/)
  })

  it("compares secrets in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true)
    expect(safeEqual("abc", "abd")).toBe(false)
    expect(safeEqual("abc", undefined)).toBe(false)
  })

  it("converts VND", () => {
    expect(toVndInteger(250000)).toBe(250000)
    expect(toVndInteger("1200")).toBe(1200)
    expect(() => toVndInteger(0)).toThrow()
  })

  it("picks locale and provider code", () => {
    expect(pickLocale("en-US,en;q=0.9")).toBe("en")
    expect(pickLocale("fr")).toBe("vi")
    expect(codeFromProviderId("pp_sepay_sepay")).toBe("sepay")
  })

  it("redacts secrets", () => {
    expect(redact({ a: 1, secret_key: "x", nested: { signature: "s" } })).toEqual({
      a: 1,
      secret_key: "***",
      nested: { signature: "***" },
    })
  })
})
