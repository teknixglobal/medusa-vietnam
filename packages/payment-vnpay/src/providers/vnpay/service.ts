import { isIP } from "net"
import {
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  assertVnd,
  parseOrigins,
  pickLocale,
  resolveReturnUrl,
  TeknixPaymentProviderBase,
  toVndInteger,
  type Locale,
  type NextAction,
  type PaymentSessionDataUpdate,
  type SessionUpdateInput,
} from "@teknixglobal/teknix-vietnam-core"
import {
  amountFromVnp,
  buildPaymentUrl,
  sessionIdFromTxnRef,
  txnRefFor,
  verifyCallback,
  vnpDate,
  VNPAY_SANDBOX_URLS,
  VnpayClient,
  type QueryDrResult,
  type VnpayEnv,
} from "../../lib/client"

export type VnpayOptions = {
  /** "sandbox" or "production". Each has its own TMN code and hash secret. */
  env: VnpayEnv
  tmn_code: string
  hash_secret: string
  /**
   * Public URL of this Medusa server. VNPay sends the customer back to
   * `<backend_url>/hooks/vnpay/return`, which redirects to the storefront return URL.
   */
  backend_url: string
  /** Production only (from your VNPay contract): payment page URL, e.g. .../vpcpay.html */
  payment_url?: string
  /** Production only (from your VNPay contract): querydr/refund API URL. */
  api_url?: string
  /** Origins allowed in data.return_url, comma separated (use STORE_CORS). */
  return_url_origins?: string | string[]
  /** Used when the storefront does not send data.return_url. */
  return_url?: string
  /** Default page language when the storefront sends no locale. */
  lang?: Locale
  /** VNPay goods category code. Default "other". */
  order_type?: string
  /** ASCII prefix of vnp_OrderInfo. Default "Thanh toan don hang". */
  order_info_prefix?: string
  /** Minutes before the payment link expires. Default 15. */
  expire_minutes?: number
  /** VNPAYQR | VNBANK | INTCARD. Empty: the customer chooses on VNPay. */
  bank_code?: string
  /** "api" (default): refund through the VNPay API. "manual": record only. "disabled": refuse. */
  refund_mode?: "api" | "manual" | "disabled"
  /** vnp_CreateBy for refunds. Default "medusa". */
  refund_created_by?: string
  /** vnp_IpAddr for querydr/refund calls. Default 127.0.0.1. */
  server_ip?: string
  timeout_ms?: number
}

export type VnpayRefund = {
  amount: number
  at: string
  mode: "api" | "manual"
  transaction_type?: "02" | "03"
  response_code?: string
}

export type VnpaySessionData = {
  session_id?: string
  return_url?: string
  locale?: string
  next_action?: NextAction | null
  vnpay?: {
    env: VnpayEnv
    txn_ref: string
    amount: number
    attempt: number
    create_date: string
    order_info: string
    ip_addr: string
    transaction_no?: string
    transaction_status?: string
    bank_code?: string
    pay_date?: string
    refunds?: VnpayRefund[]
    /** Last signed return/IPN callback for this txn ref, verified by this provider. */
    callback?: VnpayVerifiedCallback
  }
  /** Raw return/IPN query handed in by the plugin routes through updatePaymentSession; never stored. */
  vnpay_callback?: Record<string, unknown>
}

export type VnpayVerifiedCallback = {
  response_code?: string
  transaction_status?: string
  amount: number
  transaction_no?: string
  pay_date?: string
  bank_code?: string
  verified_at: string
}

/** Extra fields this provider puts in WebhookActionResult.data for the IPN route. */
export type VnpayWebhookData = {
  session_id: string
  amount: number
  vnpay_ipn: "paid" | "failed" | "bad_checksum" | "unknown_order"
  txn_ref?: string
  response_code?: string
}

type InjectedDependencies = { logger: Logger }

const BANK_CODE = /^[A-Z0-9]{3,20}$/

/** Map a verified querydr answer to a Medusa session status. */
export function mapQueryDr(result: QueryDrResult): PaymentSessionStatus {
  switch (result.vnp_ResponseCode) {
    case "00":
      break
    case "91": // no transaction yet: the customer has not paid
    case "94": // duplicate request in the API time window: ask again later
      return PaymentSessionStatus.PENDING
    default:
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `VNPay querydr failed: code ${result.vnp_ResponseCode} ${result.vnp_Message ?? ""}`.trim()
      )
  }
  switch (result.vnp_TransactionStatus) {
    case "00": // paid
    case "05": // paid, refund in progress
    case "06": // paid, refund sent to bank
    case "09": // paid, refund rejected
      return PaymentSessionStatus.CAPTURED
    default:
      // 01 incomplete, 02 failed (the customer may retry on the same link),
      // 04 reversal, 07 suspected fraud: not paid as far as the shop is concerned.
      return PaymentSessionStatus.PENDING
  }
}

class VnpayProviderService extends TeknixPaymentProviderBase<VnpayOptions> {
  static identifier = "vnpay"

  protected readonly logger_: Logger
  protected readonly options_: VnpayOptions
  protected readonly client_: VnpayClient
  protected readonly origins_: string[]
  protected readonly paymentUrl_: string

  static validateOptions(options: Record<string, unknown>): void {
    const fail = (msg: string) => {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `VNPay: ${msg}`)
    }
    for (const key of ["tmn_code", "hash_secret", "backend_url"]) {
      if (!options[key] || typeof options[key] !== "string") {
        fail(`option "${key}" is required`)
      }
    }
    if (options.env !== "sandbox" && options.env !== "production") {
      fail(`option "env" must be "sandbox" or "production"`)
    }
    if (options.env === "production" && (!options.payment_url || !options.api_url)) {
      fail(`options "payment_url" and "api_url" are required in production (see your VNPay contract)`)
    }
    try {
      new URL(options.backend_url as string)
    } catch {
      fail(`option "backend_url" must be an absolute URL`)
    }
    if (options.bank_code && !BANK_CODE.test(options.bank_code as string)) {
      fail(`option "bank_code" is invalid`)
    }
    if (options.refund_created_by && !/^[0-9A-Za-z]{1,245}$/.test(options.refund_created_by as string)) {
      fail(`option "refund_created_by" must be alphanumeric`)
    }
  }

  constructor(container: InjectedDependencies, options: VnpayOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    const sandbox = options.env === "sandbox"
    this.paymentUrl_ = options.payment_url || (sandbox ? VNPAY_SANDBOX_URLS.payment : "")
    this.client_ = new VnpayClient({
      tmnCode: options.tmn_code,
      secret: options.hash_secret,
      apiUrl: options.api_url || (sandbox ? VNPAY_SANDBOX_URLS.api : ""),
      timeoutMs: options.timeout_ms,
    })
    this.origins_ = parseOrigins(options.return_url_origins)
  }

  private get gatewayReturnUrl(): string {
    return new URL("/hooks/vnpay/return", this.options_.backend_url).toString()
  }

  private buildSession(
    sessionId: string,
    amount: number,
    attempt: number,
    returnUrl: string,
    locale: Locale,
    ipAddr: string,
    bankCode?: string
  ): VnpaySessionData {
    const txnRef = txnRefFor(sessionId, attempt)
    const now = new Date()
    const createDate = vnpDate(now)
    const expireDate = vnpDate(new Date(now.getTime() + (this.options_.expire_minutes ?? 15) * 60_000))
    const orderInfo = `${this.options_.order_info_prefix || "Thanh toan don hang"} ${txnRef}`
    const url = buildPaymentUrl({
      tmnCode: this.options_.tmn_code,
      secret: this.options_.hash_secret,
      paymentUrl: this.paymentUrl_,
      amount,
      txnRef,
      orderInfo,
      orderType: this.options_.order_type || "other",
      returnUrl: this.gatewayReturnUrl,
      ipAddr,
      locale: locale === "en" ? "en" : "vn",
      createDate,
      expireDate,
      bankCode,
    })
    return {
      session_id: sessionId,
      return_url: returnUrl,
      locale,
      next_action: { type: "redirect", url },
      vnpay: {
        env: this.options_.env,
        txn_ref: txnRef,
        amount,
        attempt,
        create_date: createDate,
        order_info: orderInfo,
        ip_addr: ipAddr,
        bank_code: bankCode,
      },
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    assertVnd(input.currency_code)
    const amount = toVndInteger(input.amount)
    const data = (input.data ?? {}) as Record<string, unknown>
    const sessionId = data.session_id as string | undefined
    if (!sessionId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "VNPay: missing session_id")
    }
    const returnUrl = resolveReturnUrl(data.return_url, this.origins_, this.options_.return_url)
    const locale = pickLocale(data.locale, this.options_.lang ?? "vi")
    // Client values are untrusted: keep them only when well formed.
    const ip = typeof data.client_ip === "string" && isIP(data.client_ip) ? data.client_ip : "127.0.0.1"
    const bank =
      typeof data.bank_code === "string" && BANK_CODE.test(data.bank_code) ? data.bank_code : this.options_.bank_code
    const session = this.buildSession(sessionId, amount, 1, returnUrl, locale, ip, bank)
    return { id: session.vnpay!.txn_ref, data: session, status: PaymentSessionStatus.PENDING }
  }

  /**
   * Medusa stores the returned data as the whole session data: never return {} here.
   * Also records a signed callback (`data.vnpay_callback`, from the plugin routes) after
   * checking its signature here, so the hash secret never leaves the provider.
   */
  // Raw return/IPN query handed in through updatePaymentSession: read, never stored.
  protected readonly transientDataKeys = ["vnpay_callback"] as const

  // updatePayment lives in TeknixPaymentProviderBase (keeps session data, F-001).
  protected updateSessionData(input: SessionUpdateInput, transient: Record<string, unknown>): PaymentSessionDataUpdate {
    const data = input.data as VnpaySessionData
    const rawCallback = transient.vnpay_callback as VnpaySessionData["vnpay_callback"]
    if (rawCallback && data.vnpay) {
      const callback = this.verifyCallbackFor(rawCallback, data.vnpay.txn_ref)
      if (!callback) {
        return {}
      }
      return {
        data: {
          vnpay: {
            ...data.vnpay,
            callback,
            transaction_no: callback.transaction_no || data.vnpay.transaction_no,
            bank_code: callback.bank_code || data.vnpay.bank_code,
            pay_date: callback.pay_date || data.vnpay.pay_date,
          },
        },
      }
    }
    if (!data.session_id || !data.vnpay || !data.return_url) {
      return {}
    }
    assertVnd(input.currency_code)
    const amount = toVndInteger(input.amount)
    if (amount === data.vnpay.amount) {
      return {}
    }
    // vnp_TxnRef must be unique: a new amount gets a new reference.
    const session = this.buildSession(
      data.session_id,
      amount,
      data.vnpay.attempt + 1,
      data.return_url,
      pickLocale(data.locale, this.options_.lang ?? "vi"),
      data.vnpay.ip_addr,
      data.vnpay.bank_code
    )
    return { data: session, status: PaymentSessionStatus.PENDING }
  }

  /** Signed return/IPN query for this txn ref, or null. */
  private verifyCallbackFor(query: Record<string, unknown>, txnRef: string): VnpayVerifiedCallback | null {
    const verified = verifyCallback(query, this.options_.hash_secret, this.options_.tmn_code)
    if (!verified || verified.vnp_TxnRef !== txnRef) {
      this.logger_.warn(`VNPay: callback for ${txnRef} rejected (bad signature or other txn ref)`)
      return null
    }
    return {
      response_code: verified.vnp_ResponseCode,
      transaction_status: verified.vnp_TransactionStatus,
      amount: amountFromVnp(verified.vnp_Amount),
      transaction_no: verified.vnp_TransactionNo,
      pay_date: verified.vnp_PayDate,
      bank_code: verified.vnp_BankCode,
      verified_at: new Date().toISOString(),
    }
  }

  /**
   * Payment status. A signed "paid" callback (IPN or return, recorded by the plugin routes)
   * is VNPay's own statement and is enough; otherwise ask VNPay with querydr.
   * The plain redirect to the storefront proves nothing on its own.
   */
  private async fetchVerified(data: VnpaySessionData): Promise<{ result: QueryDrResult; status: PaymentSessionStatus }> {
    const v = data.vnpay
    if (!v?.txn_ref) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "VNPay: session has no vnp_TxnRef")
    }
    const cb = v.callback
    if (cb?.response_code === "00" && cb.transaction_status === "00") {
      const result: QueryDrResult = {
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
        vnp_TxnRef: v.txn_ref,
        vnp_TransactionNo: cb.transaction_no,
        vnp_PayDate: cb.pay_date,
        vnp_BankCode: cb.bank_code,
      }
      if (cb.amount !== v.amount) {
        this.logger_.error(`VNPay: callback amount ${cb.amount} for ${v.txn_ref}, expected ${v.amount}`)
        return { result, status: PaymentSessionStatus.ERROR }
      }
      return { result, status: PaymentSessionStatus.CAPTURED }
    }
    const result = await this.client_.queryDr({
      txnRef: v.txn_ref,
      transactionDate: v.create_date,
      orderInfo: `Truy van ${v.txn_ref}`,
      ipAddr: this.options_.server_ip || "127.0.0.1",
    })
    let status = mapQueryDr(result)
    if (status === PaymentSessionStatus.CAPTURED) {
      if (result.vnp_TxnRef !== v.txn_ref || amountFromVnp(result.vnp_Amount) !== v.amount) {
        this.logger_.error(
          `VNPay: mismatch for ${v.txn_ref}: got ref ${result.vnp_TxnRef}, amount ${amountFromVnp(result.vnp_Amount)}, expected ${v.amount}`
        )
        status = PaymentSessionStatus.ERROR
      }
    }
    if (result.vnp_ResponseCode === "94") {
      this.logger_.warn(`VNPay: querydr for ${v.txn_ref} throttled (94), treated as pending`)
    }
    return { result, status }
  }

  private withResult(data: VnpaySessionData, result: QueryDrResult, status: PaymentSessionStatus): VnpaySessionData {
    const v = data.vnpay!
    return {
      ...data,
      next_action: status === PaymentSessionStatus.PENDING ? data.next_action : null,
      vnpay: {
        ...v,
        transaction_no: result.vnp_TransactionNo || v.transaction_no,
        transaction_status: result.vnp_TransactionStatus ?? v.transaction_status,
        pay_date: result.vnp_PayDate || v.pay_date,
        bank_code: result.vnp_BankCode || v.bank_code,
      },
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as VnpaySessionData
    const { result, status } = await this.fetchVerified(data)
    return { data: this.withResult(data, result, status), status }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as VnpaySessionData
    const { result, status } = await this.fetchVerified(data)
    return { data: this.withResult(data, result, status), status }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as VnpaySessionData
    const { result, status } = await this.fetchVerified(data)
    return { data: this.withResult(data, result, status) }
  }

  /** VNPay captures on payment; nothing to do. */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const mode = this.options_.refund_mode ?? "api"
    if (mode === "disabled") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "VNPay: refunds are disabled")
    }
    const data = (input.data ?? {}) as VnpaySessionData
    const v = data.vnpay
    if (!v?.txn_ref) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "VNPay: session has no vnp_TxnRef")
    }
    const amount = toVndInteger(input.amount)
    const previous = v.refunds ?? []
    const refunded = previous.reduce((sum, r) => sum + r.amount, 0)
    if (refunded + amount > v.amount) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `VNPay: refund of ${amount} exceeds the paid amount (${v.amount}, already refunded ${refunded})`
      )
    }
    if (mode === "manual") {
      this.logger_.warn(`VNPay: refund of ${amount} VND for ${v.txn_ref} recorded in Medusa; pay it back by hand`)
      const refunds = [...previous, { amount, at: new Date().toISOString(), mode: "manual" as const }]
      return { data: { ...data, vnpay: { ...v, refunds } } }
    }

    let transactionNo = v.transaction_no
    if (!transactionNo) {
      const { result } = await this.fetchVerified(data)
      transactionNo = result.vnp_TransactionNo
    }
    const transactionType = refunded === 0 && amount === v.amount ? "02" : "03"
    const result = await this.client_.refund({
      txnRef: v.txn_ref,
      amount,
      transactionType,
      transactionNo,
      transactionDate: v.create_date,
      createBy: this.options_.refund_created_by || "medusa",
      ipAddr: this.options_.server_ip || "127.0.0.1",
      orderInfo: `Hoan tien ${v.txn_ref}`,
    })
    if (result.vnp_ResponseCode !== "00") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `VNPay refund refused: code ${result.vnp_ResponseCode} ${result.vnp_Message ?? ""}`.trim()
      )
    }
    const refunds = [
      ...previous,
      {
        amount,
        at: new Date().toISOString(),
        mode: "api" as const,
        transaction_type: transactionType,
        response_code: result.vnp_ResponseCode,
      },
    ]
    return { data: { ...data, vnpay: { ...v, transaction_no: transactionNo, refunds } } }
  }

  /** VNPay has no cancel for unpaid links; the link simply expires. */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (input.data ?? {}) as VnpaySessionData
    return { data: { ...data, next_action: null } }
  }

  async deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  /**
   * IPN and return URL (GET query, see the plugin routes under /hooks/vnpay).
   * The query is signed with the hash secret, so a valid checksum authenticates it;
   * authorizePayment still confirms with querydr before Medusa completes the cart.
   */
  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    const query = (payload.data ?? {}) as Record<string, unknown>
    const verified = verifyCallback(query, this.options_.hash_secret, this.options_.tmn_code)
    if (!verified) {
      const data: VnpayWebhookData = { session_id: "", amount: 0, vnpay_ipn: "bad_checksum" }
      return { action: PaymentActions.NOT_SUPPORTED, data }
    }
    const txnRef = verified.vnp_TxnRef ?? ""
    const sessionId = sessionIdFromTxnRef(txnRef)
    const amount = amountFromVnp(verified.vnp_Amount)
    if (!sessionId || !Number.isFinite(amount)) {
      const data: VnpayWebhookData = { session_id: "", amount: 0, vnpay_ipn: "unknown_order", txn_ref: txnRef }
      return { action: PaymentActions.NOT_SUPPORTED, data }
    }
    const paid = verified.vnp_ResponseCode === "00" && verified.vnp_TransactionStatus === "00"
    const data: VnpayWebhookData = {
      session_id: sessionId,
      amount,
      vnpay_ipn: paid ? "paid" : "failed",
      txn_ref: txnRef,
      response_code: verified.vnp_ResponseCode,
    }
    return { action: paid ? PaymentActions.SUCCESSFUL : PaymentActions.FAILED, data }
  }
}

export default VnpayProviderService
