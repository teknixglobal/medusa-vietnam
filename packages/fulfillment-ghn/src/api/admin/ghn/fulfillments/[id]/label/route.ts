import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { loadGhnFulfillment } from "../../../../../../lib/admin-ghn"

const FORMATS = ["A5", "80x80", "52x70"] as const

/**
 * GET /admin/ghn/fulfillments/:id/label?format=A5|80x80|52x70
 * Fresh GHN label link (HTML page, valid ~30 minutes).
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const format = String(req.query.format ?? "A5")
  if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `format must be one of ${FORMATS.join(", ")}`)
  }
  const { runtime, fulfillment, order_code } = await loadGhnFulfillment(req)
  if (fulfillment.canceled_at) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Fulfillment is cancelled")
  }
  const url = await runtime.adapter.getLabelUrl([order_code], format)
  res.json({ url, format, order_code })
}
