import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { codeFromProviderId, METHOD_INFO, pickLocale } from "@teknixglobal/medusa-vietnam-core"

/**
 * GET /store/vietnam-payments/methods?region_id=reg_...&locale=vi
 * Payment providers of this plugin enabled for the region, with vi/en labels.
 * Locale: ?locale, else Accept-Language, else vi.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const regionId = req.query.region_id
  if (typeof regionId !== "string" || !regionId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "region_id is required")
  }
  const locale = pickLocale(req.query.locale ?? req.headers["accept-language"], "vi")

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "payment_providers.id", "payment_providers.is_enabled"],
    filters: { id: regionId },
  })

  const providers = (regions[0]?.payment_providers ?? []) as Array<{ id: string; is_enabled: boolean } | null>
  const methods = providers
    .filter((p): p is { id: string; is_enabled: boolean } => !!p?.is_enabled)
    .map((p) => {
      const code = codeFromProviderId(p.id)
      const info = code ? METHOD_INFO[code] : undefined
      return info
        ? {
            provider_id: p.id,
            code,
            flow: info.flow,
            label: info.label[locale],
            description: info.description[locale],
          }
        : null
    })
    .filter(Boolean)

  res.json({ locale, payment_methods: methods })
}
