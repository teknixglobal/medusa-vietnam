import { randomBytes } from "crypto"
import { hmac, safeEqual } from "@teknixglobal/medusa-vietnam-core"

/**
 * VNPay Payment Gateway 2.1.0.
 * Docs (checked 2026-11-09):
 *   sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
 *   sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html
 * Signing is done here instead of with the `vnpay` npm package: that package formats
 * dates with the server's local timezone, breaks the refund response check (it divides
 * vnp_Amount by 100 before hashing), compares hashes non constant-time and has no timeout.
 */

export type VnpayEnv = "sandbox" | "production"

export const VNP_VERSION = "2.1.0"

export const VNPAY_SANDBOX_URLS = {
  payment: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
  api: "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
}

/** Hash of the payment URL / return / IPN: sorted vnp_* params, form-urlencoded, HMAC-SHA512 hex. */
export function buildSignData(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  for (const key of Object.keys(params).sort()) {
    const value = params[key]
    if (value !== undefined && value !== null && value !== "") {
      search.append(key, String(value))
    }
  }
  return search.toString()
}

export function sign(data: string, secret: string): string {
  return hmac("sha512", secret, data, "hex")
}

/** VNPay dates: yyyyMMddHHmmss in GMT+7 (Vietnam has no DST), whatever the server timezone. */
export function vnpDate(date: Date = new Date()): string {
  const d = new Date(date.getTime() + 7 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  )
}

export type PaymentUrlInput = {
  tmnCode: string
  secret: string
  paymentUrl: string
  /** Whole dong; multiplied by 100 here as VNPay requires. */
  amount: number
  txnRef: string
  orderInfo: string
  orderType: string
  returnUrl: string
  ipAddr: string
  locale: "vn" | "en"
  createDate: string
  expireDate: string
  bankCode?: string
}

export function buildPaymentUrl(input: PaymentUrlInput): string {
  const params = {
    vnp_Version: VNP_VERSION,
    vnp_Command: "pay",
    vnp_TmnCode: input.tmnCode,
    vnp_Amount: input.amount * 100,
    vnp_CurrCode: "VND",
    vnp_TxnRef: input.txnRef,
    vnp_OrderInfo: input.orderInfo,
    vnp_OrderType: input.orderType,
    vnp_ReturnUrl: input.returnUrl,
    vnp_IpAddr: input.ipAddr,
    vnp_Locale: input.locale,
    vnp_CreateDate: input.createDate,
    vnp_ExpireDate: input.expireDate,
    vnp_BankCode: input.bankCode,
  }
  const data = buildSignData(params)
  return `${input.paymentUrl}?${data}&vnp_SecureHash=${sign(data, input.secret)}`
}

export type VnpCallback = {
  vnp_TmnCode?: string
  vnp_TxnRef?: string
  vnp_Amount?: string
  vnp_ResponseCode?: string
  vnp_TransactionStatus?: string
  vnp_TransactionNo?: string
  vnp_BankCode?: string
  vnp_PayDate?: string
  vnp_CardType?: string
  [key: string]: string | undefined
}

/**
 * Return URL and IPN query check. Only vnp_* params are signed (the return URL may carry
 * our own params). Returns the vnp_* params when the hash and the TMN code match, else null.
 */
export function verifyCallback(
  query: Record<string, unknown>,
  secret: string,
  tmnCode: string
): VnpCallback | null {
  const params: Record<string, string> = {}
  let received: string | undefined
  for (const [key, raw] of Object.entries(query ?? {})) {
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value !== "string" || !key.startsWith("vnp_")) {
      continue
    }
    if (key === "vnp_SecureHash") {
      received = value
    } else if (key !== "vnp_SecureHashType") {
      params[key] = value
    }
  }
  if (!received) {
    return null
  }
  const expected = sign(buildSignData(params), secret)
  if (!safeEqual(received.toLowerCase(), expected)) {
    return null
  }
  if (params.vnp_TmnCode !== tmnCode) {
    return null
  }
  return params
}

/** Whole dong from a vnp_Amount string (x100). NaN when malformed. */
export function amountFromVnp(value: string | number | undefined): number {
  const s = String(value ?? "")
  return /^\d+$/.test(s) ? Number(s) / 100 : NaN
}

export const pipeJoin = (values: Array<string | number | undefined | null>): string =>
  values.map((v) => (v === undefined || v === null ? "" : String(v))).join("|")

export type QueryDrResult = {
  vnp_ResponseId?: string
  vnp_Command?: string
  vnp_TmnCode?: string
  vnp_TxnRef?: string
  vnp_Amount?: string
  vnp_OrderInfo?: string
  vnp_ResponseCode?: string
  vnp_Message?: string
  vnp_BankCode?: string
  vnp_PayDate?: string
  vnp_TransactionNo?: string
  vnp_TransactionType?: string
  vnp_TransactionStatus?: string
  vnp_PromotionCode?: string
  vnp_PromotionAmount?: string
  vnp_SecureHash?: string
}

export type RefundResult = Omit<QueryDrResult, "vnp_PromotionCode" | "vnp_PromotionAmount">

/** Response checksum field order, from the querydr&refund docs. */
const QUERYDR_RESPONSE_FIELDS = [
  "vnp_ResponseId",
  "vnp_Command",
  "vnp_ResponseCode",
  "vnp_Message",
  "vnp_TmnCode",
  "vnp_TxnRef",
  "vnp_Amount",
  "vnp_BankCode",
  "vnp_PayDate",
  "vnp_TransactionNo",
  "vnp_TransactionType",
  "vnp_TransactionStatus",
  "vnp_OrderInfo",
  "vnp_PromotionCode",
  "vnp_PromotionAmount",
] as const

const REFUND_RESPONSE_FIELDS = QUERYDR_RESPONSE_FIELDS.slice(0, 13)

export function verifyApiResponse(
  body: Record<string, unknown>,
  fields: readonly string[],
  secret: string
): boolean {
  const received = typeof body.vnp_SecureHash === "string" ? body.vnp_SecureHash.toLowerCase() : undefined
  const data = pipeJoin(fields.map((f) => body[f] as string | number | undefined))
  return safeEqual(received, sign(data, secret))
}

export class VnpayApiError extends Error {}

export type VnpayClientConfig = {
  tmnCode: string
  secret: string
  apiUrl: string
  timeoutMs?: number
}

export class VnpayClient {
  constructor(private readonly config: VnpayClientConfig) {}

  /** Request ids: alphanumeric, max 32, unique per day. */
  static requestId(): string {
    return randomBytes(16).toString("hex")
  }

  private async post<T extends Record<string, unknown>>(
    body: Record<string, unknown>,
    responseFields: readonly string[]
  ): Promise<T> {
    const res = await fetch(this.config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new VnpayApiError(`VNPay ${body.vnp_Command} -> HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = (text ? JSON.parse(text) : {}) as T
    if (!verifyApiResponse(json, responseFields, this.config.secret)) {
      // Do not act on an unsigned or tampered answer.
      throw new VnpayApiError(
        `VNPay ${body.vnp_Command}: response checksum mismatch (code ${String(json.vnp_ResponseCode)})`
      )
    }
    return json
  }

  async queryDr(input: {
    txnRef: string
    transactionDate: string
    orderInfo: string
    ipAddr: string
    transactionNo?: string
  }): Promise<QueryDrResult> {
    const requestId = VnpayClient.requestId()
    const createDate = vnpDate()
    const data = pipeJoin([
      requestId,
      VNP_VERSION,
      "querydr",
      this.config.tmnCode,
      input.txnRef,
      input.transactionDate,
      createDate,
      input.ipAddr,
      input.orderInfo,
    ])
    return this.post<QueryDrResult>(
      {
        vnp_RequestId: requestId,
        vnp_Version: VNP_VERSION,
        vnp_Command: "querydr",
        vnp_TmnCode: this.config.tmnCode,
        vnp_TxnRef: input.txnRef,
        vnp_OrderInfo: input.orderInfo,
        vnp_TransactionNo: input.transactionNo,
        vnp_TransactionDate: input.transactionDate,
        vnp_CreateDate: createDate,
        vnp_IpAddr: input.ipAddr,
        vnp_SecureHash: sign(data, this.config.secret),
      },
      QUERYDR_RESPONSE_FIELDS
    )
  }

  /** transactionType: "02" full refund, "03" partial refund. amount in whole dong. */
  async refund(input: {
    txnRef: string
    amount: number
    transactionType: "02" | "03"
    transactionNo?: string
    transactionDate: string
    createBy: string
    ipAddr: string
    orderInfo: string
  }): Promise<RefundResult> {
    const requestId = VnpayClient.requestId()
    const createDate = vnpDate()
    const amount = input.amount * 100
    const transactionNo = input.transactionNo || "0"
    const data = pipeJoin([
      requestId,
      VNP_VERSION,
      "refund",
      this.config.tmnCode,
      input.transactionType,
      input.txnRef,
      amount,
      transactionNo,
      input.transactionDate,
      input.createBy,
      createDate,
      input.ipAddr,
      input.orderInfo,
    ])
    return this.post<RefundResult>(
      {
        vnp_RequestId: requestId,
        vnp_Version: VNP_VERSION,
        vnp_Command: "refund",
        vnp_TmnCode: this.config.tmnCode,
        vnp_TransactionType: input.transactionType,
        vnp_TxnRef: input.txnRef,
        vnp_Amount: amount,
        vnp_OrderInfo: input.orderInfo,
        vnp_TransactionNo: transactionNo,
        vnp_TransactionDate: input.transactionDate,
        vnp_CreateBy: input.createBy,
        vnp_CreateDate: createDate,
        vnp_IpAddr: input.ipAddr,
        vnp_SecureHash: sign(data, this.config.secret),
      },
      REFUND_RESPONSE_FIELDS
    )
  }
}

/**
 * vnp_TxnRef is alphanumeric. Medusa session ids are `payses_<26-char ULID>`:
 * the ref is the ULID, plus the attempt number from the 2nd attempt on.
 */
const SESSION_PREFIX = "payses_"
const ULID_LENGTH = 26

export function txnRefFor(sessionId: string, attempt: number): string {
  const core = sessionId.startsWith(SESSION_PREFIX) ? sessionId.slice(SESSION_PREFIX.length) : sessionId
  if (!/^[0-9A-Z]{26}$/.test(core)) {
    throw new Error(`VNPay: cannot build an alphanumeric vnp_TxnRef from session id ${sessionId}`)
  }
  return attempt > 1 ? `${core}${attempt}` : core
}

export function sessionIdFromTxnRef(txnRef: string): string | null {
  return /^[0-9A-Z]{26}\d*$/.test(txnRef) ? `${SESSION_PREFIX}${txnRef.slice(0, ULID_LENGTH)}` : null
}
