import { CarrierError, getVnProvince, getVnWard, type VnLocation } from "@teknixglobal/medusa-vietnam-shipping-core"
import map from "../data/ghn-map.json"

type GhnMap = {
  source: string
  generated_at: string
  vn_units_version: string
  provinces: Record<string, [number, string]>
  wards: Record<string, [number, string]>
}

const ghnMap = map as unknown as GhnMap

/** When and from what the bundled NSO -> GHN map was built. */
export const GHN_MAP_INFO = Object.freeze({
  source: ghnMap.source,
  generated_at: ghnMap.generated_at,
  vn_units_version: ghnMap.vn_units_version,
})

export type GhnPlace = {
  province_id: number
  province_name: string
  ward_id: number
  ward_name: string
}

/**
 * GHN names for an NSO province/ward pair, exactly as GHN's v3 catalogue
 * spells them (sent as to_/from_ward_name and _province_name with
 * is_new_*_address = true). Throws INVALID_ADDRESS for unknown codes.
 */
export function ghnPlaceFor(location: Pick<VnLocation, "province_code" | "ward_code">): GhnPlace {
  const province = ghnMap.provinces[location.province_code]
  const ward = ghnMap.wards[location.ward_code]
  const nsoWard = getVnWard(location.ward_code)
  if (!province || !ward || !getVnProvince(location.province_code) || nsoWard?.province_code !== location.province_code) {
    throw new CarrierError("ghn", "INVALID_ADDRESS", `no GHN ward for ${location.province_code}/${location.ward_code}`)
  }
  return { province_id: province[0], province_name: province[1], ward_id: ward[0], ward_name: ward[1] }
}
