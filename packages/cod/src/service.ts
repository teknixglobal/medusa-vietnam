import { AbstractPaymentProvider, MedusaError, PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
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
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { assertVnd, toVndInteger } from "@teknixglobal/medusa-vietnam-core"

export type CodOptions = {
  /** Reject COD above this amount (VND). Empty: no limit. */
  max_amount?: number
}

/**
 * Cash on delivery. The order is placed with an authorized payment;
 * capture it in Admin when the courier has collected the cash.
 */
class CodProviderService extends AbstractPaymentProvider<CodOptions> {
  static identifier = "cod"

  protected readonly options_: CodOptions

  constructor(container: Record<string, unknown>, options: CodOptions) {
    super(container, options)
    this.options_ = options ?? {}
  }

  private checkAmount(currency: string, amountInput: InitiatePaymentInput["amount"]): number {
    assertVnd(currency)
    const amount = toVndInteger(amountInput)
    const max = Number(this.options_.max_amount)
    if (max > 0 && amount > max) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `COD is not available above ${max} VND`)
    }
    return amount
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const amount = this.checkAmount(input.currency_code, input.amount)
    const sessionId = (input.data?.session_id as string) ?? `cod_${Date.now()}`
    return {
      id: sessionId,
      data: { session_id: sessionId, next_action: { type: "none" }, cod: { amount } },
      status: PaymentSessionStatus.PENDING,
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const amount = this.checkAmount(input.currency_code, input.amount)
    // Medusa stores the returned data as the whole session data: keep what is there.
    return { data: { ...(input.data ?? {}), cod: { amount } } }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return { data: input.data ?? {}, status: PaymentSessionStatus.AUTHORIZED }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: { ...(input.data ?? {}), collected_at: new Date().toISOString() } }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    return { data: input.data ?? {} }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data ?? {} }
  }

  async deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const status = input.data?.collected_at ? PaymentSessionStatus.CAPTURED : PaymentSessionStatus.AUTHORIZED
    return { data: input.data ?? {}, status }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async getWebhookActionAndData(): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}

export default CodProviderService
