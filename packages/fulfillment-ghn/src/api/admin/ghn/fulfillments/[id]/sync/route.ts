import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncGhnShipmentWorkflow } from "../../../../../../workflows/sync-ghn-shipment"
import { loadGhnFulfillment } from "../../../../../../lib/admin-ghn"

/**
 * POST /admin/ghn/fulfillments/:id/sync
 * Re-reads the order from GHN now (same workflow as the webhook and the job).
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { order_code } = await loadGhnFulfillment(req)
  const { result } = await syncGhnShipmentWorkflow(req.scope).run({ input: { order_code } })
  res.json({
    order_code,
    changed: !result.skip,
    reason: result.skip ? result.reason : undefined,
    shipped: result.ship,
    delivered: result.deliver,
    flag: result.flag,
  })
}
