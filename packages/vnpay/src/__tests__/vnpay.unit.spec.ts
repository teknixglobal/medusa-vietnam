import { createHmac } from "crypto"
import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import {
  buildPaymentUrl,
  buildSignData,
  pipeJoin,
  sessionIdFromTxnRef,
  txnRefFor,
  verifyCallback,
  vnpDate,
} from "../lib/client"
import VnpayProviderService, { mapQueryDr, type VnpaySessionData } from "../providers/vnpay/service"

const SECRET = "TESTSECRETKEY0123456789ABCDEFGHI"
const TMN = "TESTTMN1"
const SESSION = "payses_01KA0000000000000000000000"
const ULID = "01KA0000000000000000000000"

const hmac512 = (s: string) => createHmac("sha512", SECRET).update(s, "utf8").digest("hex")
const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() } as any

function provider(extra: Record<string, unknown> = {}) {
  const options = {
    env: "sandbox",
    tmn_code: TMN,
    hash_secret: SECRET,
    backend_url: "https://api.shop.test",
    return_url_origins: "https://shop.test",
    ...extra,
  } as any
  VnpayProviderService.validateOptions(options)
  return new VnpayProviderService({ logger }, options)
}

/** A callback query as VNPay would send it, signed with SECRET. */
function signedCallback(over: Record<string, string> = {}) {
  const params: Record<string, string> = {
    vnp_Amount: "25000000",
    vnp_BankCode: "NCB",
    vnp_CardType: "ATM",
    vnp_OrderInfo: `Thanh toan don hang ${ULID}`,
    vnp_PayDate: "20261109153000",
    vnp_ResponseCode: "00",
    vnp_TmnCode: TMN,
    vnp_TransactionNo: "14512345",
    vnp_TransactionStatus: "00",
    vnp_TxnRef: ULID,
    ...over,
  }
  return { ...params, vnp_SecureHashType: "HmacSHA512", vnp_SecureHash: hmac512(buildSignData(params)) }
}

const QUERYDR_FIELDS = [
  "vnp_ResponseId", "vnp_Command", "vnp_ResponseCode", "vnp_Message", "vnp_TmnCode", "vnp_TxnRef",
  "vnp_Amount", "vnp_BankCode", "vnp_PayDate", "vnp_TransactionNo", "vnp_TransactionType",
  "vnp_TransactionStatus", "vnp_OrderInfo", "vnp_PromotionCode", "vnp_PromotionAmount",
]

function signedApiResponse(body: Record<string, string>, fields = QUERYDR_FIELDS) {
  return { ...body, vnp_SecureHash: hmac512(pipeJoin(fields.map((f) => body[f]))) }
}

function mockFetch(responder: (body: any) => any) {
  const calls: any[] = []
  global.fetch = jest.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    return { ok: true, status: 200, text: async () => JSON.stringify(responder(body)) } as any
  }) as any
  return calls
}

async function initiated(p = provider(), amount = 250000): Promise<VnpaySessionData> {
  const out = await p.initiatePayment({
    amount,
    currency_code: "vnd",
    data: { session_id: SESSION, return_url: "https://shop.test/api/payment-return?cart=1" },
  } as any)
  return out.data as VnpaySessionData
}

describe("signing", () => {
  it("formats dates in GMT+7 regardless of server timezone", () => {
    expect(vnpDate(new Date(Date.UTC(2026, 10, 9, 17, 30, 5)))).toBe("20261110003005")
  })

  it("signs sorted, form-urlencoded vnp params with HMAC-SHA512 (fixed vector)", () => {
    const url = buildPaymentUrl({
      tmnCode: TMN,
      secret: SECRET,
      paymentUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      amount: 250000,
      txnRef: ULID,
      orderInfo: "Thanh toan don hang 1",
      orderType: "other",
      returnUrl: "https://api.shop.test/hooks/vnpay/return",
      ipAddr: "127.0.0.1",
      locale: "vn",
      createDate: "20261109153000",
      expireDate: "20261109154500",
    })
    const expectedData =
      "vnp_Amount=25000000&vnp_Command=pay&vnp_CreateDate=20261109153000&vnp_CurrCode=VND" +
      "&vnp_ExpireDate=20261109154500&vnp_IpAddr=127.0.0.1&vnp_Locale=vn" +
      "&vnp_OrderInfo=Thanh+toan+don+hang+1&vnp_OrderType=other" +
      "&vnp_ReturnUrl=https%3A%2F%2Fapi.shop.test%2Fhooks%2Fvnpay%2Freturn" +
      `&vnp_TmnCode=${TMN}&vnp_TxnRef=${ULID}&vnp_Version=2.1.0`
    expect(url).toBe(
      `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?${expectedData}&vnp_SecureHash=${hmac512(expectedData)}`
    )
    // Same input through the `vnpay` npm package 2.5.2 (cross-check, 2026-11-09).
    expect(url.endsWith(
      "vnp_SecureHash=c64e46162282179cea3e5c408a22404385e432388626f86e93b6d239de16fcc12143848d995541963c306d4dd18ea3ec4331147280081dd0191bfd9bf7d578fb"
    )).toBe(true)
  })

  it("verifies callbacks, ignores non-vnp params, rejects tampering and other merchants", () => {
    const q = signedCallback()
    expect(verifyCallback({ ...q, provider: "vnpay" }, SECRET, TMN)?.vnp_TxnRef).toBe(ULID)
    expect(verifyCallback({ ...q, vnp_SecureHash: q.vnp_SecureHash.toUpperCase() }, SECRET, TMN)).not.toBeNull()
    expect(verifyCallback({ ...q, vnp_Amount: "1" }, SECRET, TMN)).toBeNull()
    expect(verifyCallback({ ...q, vnp_SecureHash: undefined }, SECRET, TMN)).toBeNull()
    expect(verifyCallback(q, SECRET, "OTHERTMN")).toBeNull()
  })

  it("maps session ids to alphanumeric txn refs and back", () => {
    expect(txnRefFor(SESSION, 1)).toBe(ULID)
    expect(txnRefFor(SESSION, 3)).toBe(`${ULID}3`)
    expect(sessionIdFromTxnRef(`${ULID}3`)).toBe(SESSION)
    expect(sessionIdFromTxnRef("abc")).toBeNull()
    expect(() => txnRefFor("payses_bad-id", 1)).toThrow()
  })
})

describe("querydr mapping", () => {
  it.each([
    [{ vnp_ResponseCode: "00", vnp_TransactionStatus: "00" }, PaymentSessionStatus.CAPTURED],
    [{ vnp_ResponseCode: "00", vnp_TransactionStatus: "06" }, PaymentSessionStatus.CAPTURED],
    [{ vnp_ResponseCode: "00", vnp_TransactionStatus: "01" }, PaymentSessionStatus.PENDING],
    [{ vnp_ResponseCode: "00", vnp_TransactionStatus: "02" }, PaymentSessionStatus.PENDING],
    [{ vnp_ResponseCode: "91" }, PaymentSessionStatus.PENDING],
  ])("%j -> %s", (r, expected) => {
    expect(mapQueryDr(r)).toBe(expected)
  })

  it("throws on configuration errors", () => {
    expect(() => mapQueryDr({ vnp_ResponseCode: "97" })).toThrow(/97/)
  })
})

describe("provider", () => {
  it("validates options", () => {
    expect(() => provider({ tmn_code: "" })).toThrow(/tmn_code/)
    expect(() => provider({ env: "production" })).toThrow(/payment_url/)
    expect(() => provider({ backend_url: "not a url" })).toThrow(/backend_url/)
  })

  it("initiates a redirect through the backend return route", async () => {
    const data = await initiated()
    expect(data.next_action?.type).toBe("redirect")
    const url = new URL((data.next_action as any).url)
    expect(url.searchParams.get("vnp_Amount")).toBe("25000000")
    expect(url.searchParams.get("vnp_ReturnUrl")).toBe("https://api.shop.test/hooks/vnpay/return")
    expect(url.searchParams.get("vnp_TxnRef")).toBe(ULID)
    expect(data.vnpay).toMatchObject({ txn_ref: ULID, amount: 250000, attempt: 1 })
  })

  it("rejects a return URL on a foreign origin and non-VND carts", async () => {
    const p = provider()
    await expect(
      p.initiatePayment({ amount: 1000, currency_code: "vnd", data: { session_id: SESSION, return_url: "https://evil.test/x" } } as any)
    ).rejects.toThrow(/not allowed/)
    await expect(
      p.initiatePayment({ amount: 10, currency_code: "usd", data: { session_id: SESSION } } as any)
    ).rejects.toThrow(/VND/)
  })

  it("gets a new txn ref when the amount changes", async () => {
    const p = provider()
    const data = await initiated(p)
    expect((await p.updatePayment({ amount: 250000, currency_code: "vnd", data } as any)).data).toEqual({})
    const out = await p.updatePayment({ amount: 300000, currency_code: "vnd", data } as any)
    expect((out.data as VnpaySessionData).vnpay).toMatchObject({ txn_ref: `${ULID}2`, amount: 300000, attempt: 2 })
  })

  it("authorizes only when querydr says paid, with the signed amount", async () => {
    const p = provider()
    const data = await initiated(p)
    const base = {
      vnp_ResponseId: "r1", vnp_Command: "querydr", vnp_ResponseCode: "00", vnp_Message: "OK",
      vnp_TmnCode: TMN, vnp_TxnRef: ULID, vnp_Amount: "25000000", vnp_BankCode: "NCB",
      vnp_PayDate: "20261109153000", vnp_TransactionNo: "14512345", vnp_TransactionType: "01",
      vnp_TransactionStatus: "00", vnp_OrderInfo: "x",
    }
    const calls = mockFetch(() => signedApiResponse(base))
    const ok = await p.authorizePayment({ data } as any)
    expect(ok.status).toBe(PaymentSessionStatus.CAPTURED)
    expect((ok.data as VnpaySessionData).vnpay?.transaction_no).toBe("14512345")
    expect((ok.data as VnpaySessionData).next_action).toBeNull()
    // Request checksum in the documented order.
    const req = calls[0]
    expect(req.vnp_SecureHash).toBe(
      hmac512(pipeJoin([req.vnp_RequestId, "2.1.0", "querydr", TMN, ULID, data.vnpay!.create_date, req.vnp_CreateDate, "127.0.0.1", req.vnp_OrderInfo]))
    )

    mockFetch(() => signedApiResponse({ ...base, vnp_Amount: "100" }))
    expect((await p.authorizePayment({ data } as any)).status).toBe(PaymentSessionStatus.ERROR)

    mockFetch(() => signedApiResponse({ ...base, vnp_ResponseCode: "91", vnp_TransactionStatus: "" }))
    expect((await p.authorizePayment({ data } as any)).status).toBe(PaymentSessionStatus.PENDING)

    mockFetch(() => ({ ...signedApiResponse(base), vnp_TransactionStatus: "00", vnp_Amount: "99900" }))
    await expect(p.authorizePayment({ data } as any)).rejects.toThrow(/checksum/)
  })

  it("refunds through the API: full -> 02, partial -> 03, never above the paid amount", async () => {
    const p = provider()
    const data = await initiated(p)
    data.vnpay!.transaction_no = "14512345"
    const refundFields = QUERYDR_FIELDS.slice(0, 13)
    const calls = mockFetch((b) =>
      signedApiResponse(
        {
          vnp_ResponseId: "r2", vnp_Command: "refund", vnp_ResponseCode: "00", vnp_Message: "OK",
          vnp_TmnCode: TMN, vnp_TxnRef: ULID, vnp_Amount: String(b.vnp_Amount), vnp_BankCode: "NCB",
          vnp_PayDate: "20261109153000", vnp_TransactionNo: "14512345", vnp_TransactionType: b.vnp_TransactionType,
          vnp_TransactionStatus: "05", vnp_OrderInfo: b.vnp_OrderInfo,
        },
        refundFields
      )
    )
    const partial = await p.refundPayment({ amount: 50000, data } as any)
    expect(calls[0]).toMatchObject({ vnp_TransactionType: "03", vnp_Amount: 5000000, vnp_CreateBy: "medusa" })
    const req = calls[0]
    expect(req.vnp_SecureHash).toBe(
      hmac512(pipeJoin([req.vnp_RequestId, "2.1.0", "refund", TMN, "03", ULID, 5000000, "14512345", data.vnpay!.create_date, "medusa", req.vnp_CreateDate, "127.0.0.1", req.vnp_OrderInfo]))
    )
    const after = partial.data as VnpaySessionData
    expect(after.vnpay?.refunds).toHaveLength(1)
    await expect(p.refundPayment({ amount: 250000, data: after } as any)).rejects.toThrow(/exceeds/)

    await p.refundPayment({ amount: 250000, data } as any)
    expect(calls[1].vnp_TransactionType).toBe("02")
  })

  it("records manual refunds and refuses when disabled", async () => {
    const data = await initiated()
    const manual = await provider({ refund_mode: "manual" }).refundPayment({ amount: 1000, data } as any)
    expect((manual.data as VnpaySessionData).vnpay?.refunds?.[0]).toMatchObject({ amount: 1000, mode: "manual" })
    await expect(provider({ refund_mode: "disabled" }).refundPayment({ amount: 1000, data } as any)).rejects.toThrow(/disabled/)
  })
})

describe("IPN / return classification", () => {
  const p = provider()
  const hook = (data: Record<string, unknown>) => p.getWebhookActionAndData({ data, rawData: "", headers: {} } as any)

  it("bad checksum -> not_supported without session", async () => {
    const r = await hook({ ...signedCallback(), vnp_Amount: "1" })
    expect(r.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(r.data).toMatchObject({ session_id: "", vnpay_ipn: "bad_checksum" })
  })

  it("paid -> successful with the session id and whole-dong amount", async () => {
    const r = await hook(signedCallback({ vnp_TxnRef: `${ULID}2` }))
    expect(r.action).toBe(PaymentActions.SUCCESSFUL)
    expect(r.data).toMatchObject({ session_id: SESSION, amount: 250000, vnpay_ipn: "paid", txn_ref: `${ULID}2` })
  })

  it("customer cancelled (24) -> failed", async () => {
    const r = await hook(signedCallback({ vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }))
    expect(r.action).toBe(PaymentActions.FAILED)
    expect(r.data).toMatchObject({ session_id: SESSION, response_code: "24" })
  })

  it("unknown txn ref -> not_supported", async () => {
    const r = await hook(signedCallback({ vnp_TxnRef: "ORDER123" }))
    expect(r.action).toBe(PaymentActions.NOT_SUPPORTED)
  })
})
