import { createHmac } from "crypto"
import { buildCheckoutForm, buildSigningString, signCheckout } from "../client"
import SepayProviderService, { mapSepayStatus, sessionIdFromInvoice } from "../service"

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as any

const options = {
  env: "sandbox" as const,
  merchant_id: "MERCHANT_123",
  secret_key: "test-secret",
  ipn_secret_key: "ipn-secret",
  return_url_origins: "https://shop.test,http://localhost:8000",
}

describe("SePay signing", () => {
  // Example from developer.sepay.vn/en/cong-thanh-toan/API/don-hang/form-thanh-toan (2026-11-09)
  const fields = {
    merchant: "MERCHANT_123",
    currency: "VND",
    order_amount: "100000",
    operation: "PURCHASE",
    order_description: "Payment for order #12345",
    order_invoice_number: "INV_20231201_001",
    customer_id: "",
    success_url: "https://yoursite.com/payment/success",
    error_url: "https://yoursite.com/payment/error",
    cancel_url: "https://yoursite.com/payment/cancel",
  }

  it("builds the signing string in documented order, skipping empty fields", () => {
    expect(buildSigningString(fields)).toBe(
      "order_amount=100000,merchant=MERCHANT_123,currency=VND,operation=PURCHASE,order_description=Payment for order #12345,order_invoice_number=INV_20231201_001,success_url=https://yoursite.com/payment/success,error_url=https://yoursite.com/payment/error,cancel_url=https://yoursite.com/payment/cancel"
    )
  })

  it("signs with HMAC-SHA256 base64", () => {
    const expected = createHmac("sha256", "k").update(buildSigningString(fields)).digest("base64")
    expect(signCheckout(fields, "k")).toBe(expected)
  })

  it("emits form fields in signing order, lang unsigned, signature last", () => {
    const form = buildCheckoutForm({ ...fields, lang: "en" }, "k")
    expect(form.map(([k]) => k)).toEqual([
      "order_amount",
      "merchant",
      "currency",
      "operation",
      "order_description",
      "order_invoice_number",
      "success_url",
      "error_url",
      "cancel_url",
      "lang",
      "signature",
    ])
    expect(form[form.length - 1][1]).toBe(signCheckout(fields, "k"))
  })
})

describe("SePay provider", () => {
  const service = new SepayProviderService({ logger }, options)

  it("rejects non-VND and return URLs on other origins", async () => {
    await expect(
      service.initiatePayment({ amount: 1000, currency_code: "usd", data: { session_id: "payses_1" } })
    ).rejects.toThrow(/VND/)
    await expect(
      service.initiatePayment({
        amount: 1000,
        currency_code: "vnd",
        data: { session_id: "payses_1", return_url: "https://evil.test/back" },
      })
    ).rejects.toThrow(/not allowed/)
  })

  it("creates a signed form_post next action", async () => {
    const out = await service.initiatePayment({
      amount: 250000,
      currency_code: "vnd",
      data: { session_id: "payses_1", return_url: "https://shop.test/api/payment-return?cart_id=c1", locale: "en-US" },
    })
    const data = out.data as any
    expect(out.id).toBe("payses_1")
    expect(data.next_action.type).toBe("form_post")
    expect(data.next_action.url).toBe("https://pay-sandbox.sepay.vn/v1/checkout/init")
    const fields = Object.fromEntries(data.next_action.fields)
    expect(fields.order_amount).toBe("250000")
    expect(fields.lang).toBe("en")
    expect(fields.success_url).toBe("https://shop.test/api/payment-return?cart_id=c1&provider=sepay&result=success")
    expect(data.sepay).toMatchObject({ invoice_number: "payses_1", amount: 250000, attempt: 1 })
  })

  it("rejects decimal VND", async () => {
    await expect(
      service.initiatePayment({ amount: 1000.5, currency_code: "vnd", data: { session_id: "payses_1" } })
    ).rejects.toThrow(/whole number/)
  })

  it("maps order status and invoice numbers", () => {
    expect(mapSepayStatus({ order_status: "CAPTURED" } as any)).toBe("captured")
    expect(mapSepayStatus({ order_status: "CANCELLED" } as any)).toBe("canceled")
    expect(mapSepayStatus(null)).toBe("pending")
    expect(sessionIdFromInvoice("payses_01ABC-2")).toBe("payses_01ABC")
  })

  it("ignores IPN with a wrong secret", async () => {
    const res = await service.getWebhookActionAndData({
      data: { notification_type: "ORDER_PAID", order: { order_invoice_number: "payses_1" } },
      rawData: "",
      headers: { "x-secret-key": "wrong" },
    })
    expect(res.action).toBe("not_supported")
  })

  it("accepts IPN only when the API confirms capture", async () => {
    const spy = jest
      .spyOn((service as any).client_, "retrieveOrder")
      .mockResolvedValue({ order_invoice_number: "payses_9-2", order_status: "CAPTURED", order_amount: "250000" })
    const res = await service.getWebhookActionAndData({
      data: { notification_type: "ORDER_PAID", order: { order_invoice_number: "payses_9-2" } },
      rawData: "",
      headers: { "x-secret-key": "ipn-secret" },
    })
    expect(res).toEqual({ action: "captured", data: { session_id: "payses_9", amount: 250000 } })
    spy.mockResolvedValue({ order_invoice_number: "payses_9-2", order_status: "AUTHENTICATION_NOT_NEEDED", order_amount: "250000" })
    const pending = await service.getWebhookActionAndData({
      data: { notification_type: "ORDER_PAID", order: { order_invoice_number: "payses_9-2" } },
      rawData: "",
      headers: { "x-secret-key": "ipn-secret" },
    })
    expect(pending.action).toBe("not_supported")
  })

  it("refuses authorization when the paid amount differs", async () => {
    jest
      .spyOn((service as any).client_, "retrieveOrder")
      .mockResolvedValue({ order_invoice_number: "payses_1", order_status: "CAPTURED", order_amount: "1000" })
    const res = await service.authorizePayment({
      data: { session_id: "payses_1", sepay: { env: "sandbox", invoice_number: "payses_1", amount: 250000, attempt: 1 } },
    })
    expect(res.status).toBe("error")
    expect(logger.error).toHaveBeenCalled()
  })
})
