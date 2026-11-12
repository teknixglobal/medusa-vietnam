import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GhnAdapter } from "./adapter"
import type { GhnProviderOptions } from "../providers/ghn/service"

type ProviderEntry = { resolve?: string; id?: string; options?: Record<string, unknown> }
type ModuleEntry = { resolve?: string; key?: string; options?: { providers?: ProviderEntry[] } }

export type GhnRuntime = {
  /** Medusa provider id, e.g. "ghn_ghn". */
  provider_id: string
  options: GhnProviderOptions
  adapter: GhnAdapter
}

const cache = new WeakMap<object, GhnRuntime | null>()

const GHN_PACKAGE_NAMES = ["teknix-vietnam-fulfillment-ghn-medusa-plugin", "medusa-fulfillment-ghn"]

function isGhnProvider(p: ProviderEntry): boolean {
  const resolve = String(p.resolve ?? "")
  // New package name (D-093), plus the old one for medusa-config files not yet updated
  return GHN_PACKAGE_NAMES.some((n) => resolve.includes(n)) || /providers\/ghn\/?$/.test(resolve)
}

/**
 * The plugin's routes, subscribers and jobs run outside the fulfillment module,
 * so they read the GHN provider options from medusa-config (modules accept the
 * array or the keyed form) and build their own adapter. Null when GHN is not configured.
 */
export function ghnRuntimeFrom(container: MedusaContainer): GhnRuntime | null {
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as { modules?: unknown }
  if (cache.has(config)) {
    return cache.get(config) ?? null
  }
  const modules = (Array.isArray(config.modules) ? config.modules : Object.values(config.modules ?? {})) as ModuleEntry[]
  let found: ProviderEntry | undefined
  for (const mod of modules) {
    found = mod?.options?.providers?.find(isGhnProvider)
    if (found) break
  }
  const runtime: GhnRuntime | null = found?.options
    ? (() => {
        const options = found!.options as unknown as GhnProviderOptions
        return {
          provider_id: `ghn_${found!.id ?? "ghn"}`,
          options,
          adapter: new GhnAdapter({
            env: options.env,
            token: options.token,
            shop_id: Number(options.shop_id),
            timeout_ms: options.timeout_ms,
            webhook_secret: options.webhook_secret,
            webhook_header: options.webhook_header,
          }),
        }
      })()
    : null
  cache.set(config, runtime)
  return runtime
}
