import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getVnProvince, listVnWards } from "@teknixglobal/medusa-vietnam-shipping-core"

/** GET /store/vn-address/provinces/:code/wards: wards (phường, xã, đặc khu) of one province. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const code = String(req.params.code ?? "")
  if (!getVnProvince(code)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Province ${code} not found`)
  }
  res.setHeader("Cache-Control", "public, max-age=86400")
  res.json({
    wards: listVnWards(code).map((w) => ({
      code: w.code,
      name: w.name,
      full_name: w.full_name,
      postal_code: w.postal_code,
    })),
  })
}
