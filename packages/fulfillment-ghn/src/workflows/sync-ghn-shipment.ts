import { createOrderShipmentWorkflow, markOrderFulfillmentAsDeliveredWorkflow } from "@medusajs/medusa/core-flows"
import { createWorkflow, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { planGhnSync } from "./plan"
import { fetchGhnShipmentStep, findGhnFulfillmentStep, updateGhnFulfillmentDataStep } from "./steps/ghn-sync"

export type SyncGhnShipmentInput = {
  order_code: string
  /** From the webhook, display only (kept when GHN confirms the same status). */
  reported?: { reason?: string; reason_code?: string; raw_status?: string }
}

/**
 * Brings one GHN order into Medusa: re-reads the status from GHN, stores it on
 * fulfillment.data, then marks the fulfillment shipped / delivered with
 * Medusa's own workflows. Safe to run again (webhook retries, polling job).
 */
export const syncGhnShipmentWorkflow = createWorkflow(
  "sync-ghn-shipment",
  function (input: SyncGhnShipmentInput) {
    const fetched = fetchGhnShipmentStep({ order_code: input.order_code })
    const fulfillment = findGhnFulfillmentStep(fetched)
    const plan = transform({ fetched, fulfillment, input }, ({ fetched, fulfillment, input }) =>
      planGhnSync(fetched.snapshot, fulfillment, new Date().toISOString(), input.reported)
    )

    when("ghn-sync-update", plan, (p) => !p.skip).then(function () {
      const update = transform({ plan }, ({ plan }) => ({
        id: plan.fulfillment_id as string,
        data: plan.data as Record<string, unknown>,
        previous: plan.previous as Record<string, unknown>,
      }))
      updateGhnFulfillmentDataStep(update)
    })

    when("ghn-sync-ship", plan, (p) => !p.skip && p.ship).then(function () {
      const shipment = transform({ plan }, ({ plan }) => ({
        order_id: plan.order_id as string,
        fulfillment_id: plan.fulfillment_id as string,
        items: plan.items,
      }))
      createOrderShipmentWorkflow.runAsStep({ input: shipment })
    })

    when("ghn-sync-deliver", plan, (p) => !p.skip && p.deliver).then(function () {
      const delivered = transform({ plan }, ({ plan }) => ({
        orderId: plan.order_id as string,
        fulfillmentId: plan.fulfillment_id as string,
      }))
      markOrderFulfillmentAsDeliveredWorkflow.runAsStep({ input: delivered })
    })

    return new WorkflowResponse(plan)
  }
)
