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
  safeEqual,
  TeknixPaymentProviderBase,
  toVndInteger,
  withParams,
  type PaymentSessionDataUpdate,
  type SessionUpdateInput,
  type Locale,
  type NextAction,
} from "@teknixglobal/teknix-vietnam-core"
import { buildCheckoutForm, SepayClient, type SepayEnv, type SepayOrder } from "./client"

export type SepayOptions = {
  /** "sandbox" or "production". Each has its own merchant id and secret key. */
  env: SepayEnv
  merchant_id: string
  secret_key: string
  /** IPN secret (Payment Gateway > Configuration > IPN, auth type SECRET_KEY). Optional: IPNs are always re-checked against the order API. */
  ipn_secret_key?: string
  /** Origins allowed in data.return_url, comma separated (use STORE_CORS). */
  return_url_origins?: string | string[]
  /** Used when the storefront does not send data.return_url. */
  return_url?: string
  /** CARD | BANK_TRANSFER | NAPAS_BANK_TRANSFER. Empty: the customer chooses on SePay. */
  payment_method?: string
  /** Default page language when the storefront sends no locale. */
  lang?: Locale
  /** ASCII text shown on the SePay page and in the bank transfer note. */
  order_description?: string
  /** Refunds: SePay has no refund API for paid orders, so refunds are recorded in Medusa and paid back by hand. */
  refund_mode?: "manual" | "disabled"
  timeout_ms?: number
}

type SepaySessionData = {
  session_id?: string
  return_url?: string
  locale?: string
  next_action?: NextAction | null
  sepay?: {
    env: SepayEnv
    invoice_number: string
    amount: number
    attempt: number
    status?: string
    order_id?: string
    refunds?: Array<{ amount: number; at: string; mode: string }>
  }
}

type InjectedDependencies = { logger: Logger }

const INVOICE_SEPARATOR = "-"

export function sessionIdFromInvoice(invoice: string): string {
  return invoice.split(INVOICE_SEPARATOR)[0]
}

export function mapSepayStatus(order: SepayOrder | null): PaymentSessionStatus {
  switch (order?.order_status) {
    case "CAPTURED":
      return PaymentSessionStatus.CAPTURED
    case "CANCELLED":
    case "CANCELED":
      return PaymentSessionStatus.CANCELED
    default:
      return PaymentSessionStatus.PENDING
  }
}

class SepayProviderService extends TeknixPaymentProviderBase<SepayOptions> {
  static identifier = "sepay"

  protected readonly logger_: Logger
  protected readonly options_: SepayOptions
  protected readonly client_: SepayClient
  protected readonly origins_: string[]

  static validateOptions(options: Record<string, unknown>): void {
    for (const key of ["merchant_id", "secret_key"]) {
      if (!options[key] || typeof options[key] !== "string") {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `SePay: option "${key}" is required`)
      }
    }
    if (options.env !== "sandbox" && options.env !== "production") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `SePay: option "env" must be "sandbox" or "production"`)
    }
  }

  constructor(container: InjectedDependencies, options: SepayOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    this.client_ = new SepayClient(options.env, options.merchant_id, options.secret_key, options.timeout_ms)
    this.origins_ = parseOrigins(options.return_url_origins)
  }

  private buildSession(
    sessionId: string,
    amount: number,
    attempt: number,
    returnUrl: string,
    locale: Locale,
    customerId?: string
  ): SepaySessionData {
    const invoice = attempt > 1 ? `${sessionId}${INVOICE_SEPARATOR}${attempt}` : sessionId
    const result = (r: string) => withParams(returnUrl, { provider: "sepay", result: r })
    const fields = buildCheckoutForm(
      {
        order_amount: String(amount),
        merchant: this.options_.merchant_id,
        currency: "VND",
        operation: "PURCHASE",
        order_description: this.options_.order_description || `Thanh toan don hang ${invoice}`,
        order_invoice_number: invoice,
        customer_id: customerId,
        payment_method: this.options_.payment_method,
        success_url: result("success"),
        error_url: result("error"),
        cancel_url: result("cancel"),
        lang: locale,
      },
      this.options_.secret_key
    )
    return {
      session_id: sessionId,
      return_url: returnUrl,
      locale,
      next_action: { type: "form_post", url: this.client_.checkoutUrl, fields },
      sepay: { env: this.options_.env, invoice_number: invoice, amount, attempt },
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    assertVnd(input.currency_code)
    const amount = toVndInteger(input.amount)
    const data = (input.data ?? {}) as Record<string, unknown>
    const sessionId = data.session_id as string | undefined
    if (!sessionId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "SePay: missing session_id")
    }
    const returnUrl = resolveReturnUrl(data.return_url, this.origins_, this.options_.return_url)
    const locale = pickLocale(data.locale, this.options_.lang ?? "vi")
    const session = this.buildSession(sessionId, amount, 1, returnUrl, locale, input.context?.customer?.id)
    return {
      id: session.sepay!.invoice_number,
      data: session,
      status: PaymentSessionStatus.PENDING,
    }
  }

  // updatePayment lives in TeknixPaymentProviderBase (keeps session data, F-001).
  protected updateSessionData(input: SessionUpdateInput): PaymentSessionDataUpdate {
    const data = input.data as SepaySessionData
    if (!data.session_id || !data.sepay || !data.return_url) {
      // Caller did not pass the stored session data: nothing to rebuild.
      return {}
    }
    assertVnd(input.currency_code)
    const amount = toVndInteger(input.amount)
    if (amount === data.sepay.amount) {
      return {}
    }
    // New amount -> new invoice number, SePay invoices are unique.
    const session = this.buildSession(
      data.session_id,
      amount,
      data.sepay.attempt + 1,
      data.return_url,
      pickLocale(data.locale, this.options_.lang ?? "vi")
    )
    return { data: session, status: PaymentSessionStatus.PENDING }
  }

  /** Ask SePay; the redirect back to the shop proves nothing on its own. */
  private async fetchVerified(data: SepaySessionData): Promise<{ order: SepayOrder | null; status: PaymentSessionStatus }> {
    if (!data.sepay?.invoice_number) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "SePay: session has no invoice number")
    }
    const order = await this.client_.retrieveOrder(data.sepay.invoice_number)
    let status = mapSepayStatus(order)
    if (status === PaymentSessionStatus.CAPTURED && Number(order!.order_amount) !== data.sepay.amount) {
      this.logger_.error(
        `SePay: amount mismatch for ${data.sepay.invoice_number}: paid ${order!.order_amount}, expected ${data.sepay.amount}`
      )
      status = PaymentSessionStatus.ERROR
    }
    return { order, status }
  }

  private withOrder(data: SepaySessionData, order: SepayOrder | null, status: PaymentSessionStatus): SepaySessionData {
    return {
      ...data,
      next_action: status === PaymentSessionStatus.PENDING ? data.next_action : null,
      sepay: { ...data.sepay!, status: order?.order_status ?? data.sepay?.status, order_id: order?.order_id ?? order?.id ?? data.sepay?.order_id },
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as SepaySessionData
    const { order, status } = await this.fetchVerified(data)
    return { data: this.withOrder(data, order, status), status }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as SepaySessionData
    const { order, status } = await this.fetchVerified(data)
    return { data: this.withOrder(data, order, status), status }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as SepaySessionData
    const { order, status } = await this.fetchVerified(data)
    return { data: this.withOrder(data, order, status) }
  }

  /** SePay captures on payment; nothing to do. */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    if (this.options_.refund_mode === "disabled") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "SePay: refunds are disabled")
    }
    const data = (input.data ?? {}) as SepaySessionData
    const amount = toVndInteger(input.amount)
    this.logger_.warn(
      `SePay: refund of ${amount} VND for ${data.sepay?.invoice_number} recorded in Medusa; pay it back to the customer by hand`
    )
    const refunds = [...(data.sepay?.refunds ?? []), { amount, at: new Date().toISOString(), mode: "manual" }]
    return { data: { ...data, sepay: { ...data.sepay!, refunds } } }
  }

  private async cancelIfOpen(data: SepaySessionData): Promise<void> {
    const invoice = data.sepay?.invoice_number
    if (!invoice) {
      return
    }
    try {
      const order = await this.client_.retrieveOrder(invoice)
      if (order && mapSepayStatus(order) === PaymentSessionStatus.PENDING) {
        await this.client_.cancelOrder(invoice)
      }
    } catch (e) {
      this.logger_.warn(`SePay: could not cancel ${invoice}: ${(e as Error).message}`)
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (input.data ?? {}) as SepaySessionData
    await this.cancelIfOpen(data)
    return { data: { ...data, next_action: null } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    await this.cancelIfOpen((input.data ?? {}) as SepaySessionData)
    return { data: {} }
  }

  /**
   * IPN: POST /hooks/payment/sepay_sepay
   * The payload is never trusted: the order is re-read from the SePay API.
   */
  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    const notSupported = { action: PaymentActions.NOT_SUPPORTED }
    const headers = (payload.headers ?? {}) as Record<string, string | string[] | undefined>
    if (this.options_.ipn_secret_key) {
      const header = headers["x-secret-key"]
      if (!safeEqual(Array.isArray(header) ? header[0] : header, this.options_.ipn_secret_key)) {
        this.logger_.warn("SePay IPN: bad X-Secret-Key, ignored")
        return notSupported
      }
    }
    const body = (payload.data ?? {}) as {
      notification_type?: string
      order?: { order_invoice_number?: string }
    }
    const invoice = body.order?.order_invoice_number
    if (body.notification_type !== "ORDER_PAID" || !invoice) {
      return notSupported
    }
    const order = await this.client_.retrieveOrder(invoice)
    if (mapSepayStatus(order) !== PaymentSessionStatus.CAPTURED) {
      return notSupported
    }
    return {
      action: PaymentActions.SUCCESSFUL,
      data: { session_id: sessionIdFromInvoice(invoice), amount: Number(order!.order_amount) },
    }
  }
}

export default SepayProviderService
