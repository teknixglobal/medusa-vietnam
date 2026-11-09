import { PaymentSessionStatus } from "@medusajs/framework/utils"
import {
  keepSessionData,
  splitSessionData,
  TeknixPaymentProviderBase,
  type PaymentSessionData,
  type PaymentSessionDataUpdate,
  type SessionUpdateInput,
} from "../payment-provider"

type Call = { input: SessionUpdateInput; transient: PaymentSessionData }

class TestProvider extends TeknixPaymentProviderBase {
  static identifier = "test"
  protected readonly transientDataKeys = ["callback"]
  calls: Call[] = []
  next: PaymentSessionDataUpdate | void = undefined

  constructor() {
    super({}, {})
  }

  protected async updateSessionData(input: SessionUpdateInput, transient: PaymentSessionData) {
    this.calls.push({ input, transient })
    return this.next
  }

  // AbstractPaymentProvider members not under test.
  initiatePayment = jest.fn()
  authorizePayment = jest.fn()
  capturePayment = jest.fn()
  cancelPayment = jest.fn()
  deletePayment = jest.fn()
  refundPayment = jest.fn()
  retrievePayment = jest.fn()
  getPaymentStatus = jest.fn()
  getWebhookActionAndData = jest.fn()
}

const stored = { session_id: "payses_1", gw: { amount: 100, attempt: 1 }, return_url: "https://shop.test/r" }

describe("F-001 updatePayment keeps session data", () => {
  it("keeps everything when the provider changes nothing", async () => {
    const p = new TestProvider()
    for (const next of [undefined, {}, { data: {} }]) {
      p.next = next
      const out = await p.updatePayment({ amount: 100, currency_code: "vnd", data: stored } as any)
      expect(out).toEqual({ data: stored })
    }
  })

  it("merges a patch over the stored data (shallow)", async () => {
    const p = new TestProvider()
    p.next = { data: { gw: { amount: 200, attempt: 2 } }, status: PaymentSessionStatus.PENDING }
    const out = await p.updatePayment({ amount: 200, currency_code: "vnd", data: stored } as any)
    expect(out).toEqual({
      data: { ...stored, gw: { amount: 200, attempt: 2 } },
      status: PaymentSessionStatus.PENDING,
    })
  })

  it("never stores transient keys but hands them to the provider", async () => {
    const p = new TestProvider()
    const out = await p.updatePayment({
      amount: 100,
      currency_code: "vnd",
      data: { ...stored, callback: { code: "00" } },
    } as any)
    expect(out.data).toEqual(stored)
    expect(p.calls[0].input.data).toEqual(stored)
    expect(p.calls[0].transient).toEqual({ callback: { code: "00" } })
  })

  it("does not mutate the caller's data", async () => {
    const p = new TestProvider()
    const data = { ...stored, callback: { code: "00" } }
    p.next = { data: { extra: 1 } }
    await p.updatePayment({ amount: 100, currency_code: "vnd", data } as any)
    expect(data).toEqual({ ...stored, callback: { code: "00" } })
  })

  it("handles missing data", async () => {
    const p = new TestProvider()
    expect(await p.updatePayment({ amount: 1, currency_code: "vnd" } as any)).toEqual({ data: {} })
    expect(p.calls[0].input.data).toEqual({})
  })

  it("is still a Medusa payment provider", () => {
    expect(TestProvider._isPaymentProvider).toBe(true)
  })

  it("exposes the helpers", () => {
    expect(splitSessionData({ a: 1, t: 2 }, ["t"])).toEqual({ stored: { a: 1 }, transient: { t: 2 } })
    expect(keepSessionData({ a: 1, b: 1 }, { data: { b: 2 } })).toEqual({ data: { a: 1, b: 2 } })
  })
})
