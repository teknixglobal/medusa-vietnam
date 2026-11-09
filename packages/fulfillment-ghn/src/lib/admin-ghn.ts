import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { ghnRuntimeFrom, type GhnRuntime } from "./config"

export type GhnFulfillmentRow = {
  id: string
  provider_id: string
  canceled_at?: string | Date | null
  data: Record<string, unknown>
}

/** Loads a GHN fulfillment (read only) and the GHN runtime, or throws NOT_FOUND / NOT_ALLOWED. */
export async function loadGhnFulfillment(req: MedusaRequest): Promise<{ runtime: GhnRuntime; fulfillment: GhnFulfillmentRow; order_code: string }> {
  const runtime = ghnRuntimeFrom(req.scope)
  if (!runtime) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "GHN is not configured")
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "provider_id", "canceled_at", "data"],
    filters: { id: req.params.id },
  })
  const fulfillment = data[0] as GhnFulfillmentRow | undefined
  const orderCode = fulfillment?.data?.ghn_order_code
  if (!fulfillment || fulfillment.provider_id !== runtime.provider_id || typeof orderCode !== "string") {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `GHN fulfillment ${req.params.id} not found`)
  }
  return { runtime, fulfillment, order_code: orderCode }
}
