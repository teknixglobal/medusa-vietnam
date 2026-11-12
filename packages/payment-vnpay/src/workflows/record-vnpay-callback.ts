import type { IPaymentModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

export type RecordVnpayCallbackInput = {
  session_id: string
  /** Raw return/IPN query; the provider checks the signature in updatePayment. */
  query: Record<string, unknown>
}

type Previous = { id: string; data: Record<string, unknown>; amount: number; currency_code: string }

const recordVnpayCallbackStep = createStep(
  "record-vnpay-callback",
  async (input: RecordVnpayCallbackInput, { container }) => {
    const payment = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
    const session = await payment.retrievePaymentSession(input.session_id, {
      select: ["id", "data", "amount", "currency_code"],
    })
    const previous: Previous = {
      id: session.id,
      data: (session.data ?? {}) as Record<string, unknown>,
      amount: Number(session.amount),
      currency_code: session.currency_code,
    }
    const updated = await payment.updatePaymentSession({
      id: session.id,
      amount: previous.amount,
      currency_code: previous.currency_code,
      data: { ...previous.data, vnpay_callback: input.query },
    })
    return new StepResponse(updated, previous)
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }
    const payment = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
    await payment.updatePaymentSession(previous)
  }
)

/** Store a signed VNPay callback on its payment session (used by /hooks/vnpay/*). */
export const recordVnpayCallbackWorkflow = createWorkflow(
  "record-vnpay-callback",
  function (input: RecordVnpayCallbackInput) {
    const session = recordVnpayCallbackStep(input)
    return new WorkflowResponse(session)
  }
)
