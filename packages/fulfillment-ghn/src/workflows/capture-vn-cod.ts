import { capturePaymentWorkflow } from "@medusajs/medusa/core-flows"
import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { VN_COD_CAPTURE_METADATA_KEY, type VnCodCaptureRecord } from "@teknixglobal/medusa-vietnam-shipping-core"
import { setOrderMetadataStep } from "./steps/ghn-sync"

export type CaptureVnCodInput = { order_id: string; payment_id: string; amount: number; record: VnCodCaptureRecord }

/** Captures the COD payment after a carrier-confirmed delivery and records it on the order. */
export const captureVnCodPaymentWorkflow = createWorkflow(
  "capture-vn-cod-payment",
  function (input: CaptureVnCodInput) {
    capturePaymentWorkflow.runAsStep({ input: { payment_id: input.payment_id, amount: input.amount } })
    const value = setOrderMetadataStep({ order_id: input.order_id, key: VN_COD_CAPTURE_METADATA_KEY, value: input.record })
    return new WorkflowResponse(value)
  }
)

export type RecordVnCodCaptureInput = { order_id: string; record: VnCodCaptureRecord }

/** Records why the COD was not captured automatically (order.metadata.vn_cod_capture). */
export const recordVnCodCaptureWorkflow = createWorkflow(
  "record-vn-cod-capture",
  function (input: RecordVnCodCaptureInput) {
    const value = setOrderMetadataStep({ order_id: input.order_id, key: VN_COD_CAPTURE_METADATA_KEY, value: input.record })
    return new WorkflowResponse(value)
  }
)
