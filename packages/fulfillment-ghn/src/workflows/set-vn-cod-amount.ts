import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { VN_COD_METADATA_KEY } from "@teknixglobal/teknix-vietnam-shipping-core"
import { setOrderMetadataStep } from "./steps/ghn-sync"

export type SetVnCodAmountInput = { order_id: string; amount: number }

/** Records the COD amount the carrier must collect (order.metadata.vn_shipping_cod_amount). */
export const setVnCodAmountWorkflow = createWorkflow(
  "set-vn-cod-amount",
  function (input: SetVnCodAmountInput) {
    const value = setOrderMetadataStep({ order_id: input.order_id, key: VN_COD_METADATA_KEY, value: input.amount })
    return new WorkflowResponse(value)
  }
)
