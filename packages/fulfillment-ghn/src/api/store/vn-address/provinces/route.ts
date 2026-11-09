import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listVnProvinces, VN_UNITS_DATASET } from "@teknixglobal/medusa-vietnam-shipping-core"

/**
 * GET /store/vn-address/provinces: the 34 provinces of the 2025 map (NSO codes),
 * for the storefront's two-tier address form. Static data, cached a day.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "public, max-age=86400")
  res.json({
    provinces: listVnProvinces().map((p) => ({ code: p.code, name: p.name, full_name: p.full_name })),
    dataset: VN_UNITS_DATASET,
  })
}
