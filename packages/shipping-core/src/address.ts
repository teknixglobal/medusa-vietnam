import { getVnProvince, getVnWard, listVnWards, type VnProvince, type VnWard } from "./vn-units"

/** Marks addresses written for the 2025 two-tier map (province + ward, no district). */
export const VN_ADDRESS_SCHEME = "2025" as const

/** Metadata key on Medusa addresses (cart, customer, order). */
export const VN_ADDRESS_METADATA_KEY = "vn_address" as const

export type GeoPoint = { lat: number; lng: number }

/** What we store in `address.metadata.vn_address`. */
export type VnAddressRef = {
  scheme: typeof VN_ADDRESS_SCHEME
  province_code: string
  ward_code: string
  geo?: GeoPoint
}

export type ResolvedVnAddress = VnAddressRef & {
  province: VnProvince
  ward: VnWard
}

type AddressLike = { metadata?: Record<string, unknown> | null } | null | undefined

function isGeoPoint(value: unknown): value is GeoPoint {
  const v = value as GeoPoint
  return (
    !!v &&
    typeof v.lat === "number" &&
    typeof v.lng === "number" &&
    Math.abs(v.lat) <= 90 &&
    Math.abs(v.lng) <= 180
  )
}

/**
 * Reads and checks `metadata.vn_address`. Returns null when it is missing, uses
 * another scheme, or names a ward that is not in the given province (e.g. an
 * address saved before the reorganisation, or a ward since merged away).
 */
export function readVnAddress(address: AddressLike): ResolvedVnAddress | null {
  const raw = address?.metadata?.[VN_ADDRESS_METADATA_KEY] as Partial<VnAddressRef> | undefined
  if (!raw || typeof raw !== "object" || raw.scheme !== VN_ADDRESS_SCHEME) {
    return null
  }
  const province = getVnProvince(raw.province_code)
  const ward = getVnWard(raw.ward_code)
  if (!province || !ward || ward.province_code !== province.code) {
    return null
  }
  const ref: ResolvedVnAddress = {
    scheme: VN_ADDRESS_SCHEME,
    province_code: province.code,
    ward_code: ward.code,
    province,
    ward,
  }
  if (isGeoPoint(raw.geo)) {
    ref.geo = { lat: raw.geo.lat, lng: raw.geo.lng }
  }
  return ref
}

/**
 * Builds the metadata patch for an address picked in a two-tier form.
 * Throws when the ward does not belong to the province.
 * Also returns the display fields to write into `province` / `city`.
 */
export function buildVnAddress(
  provinceCode: string,
  wardCode: string,
  geo?: GeoPoint
): {
  metadata: { [VN_ADDRESS_METADATA_KEY]: VnAddressRef }
  province: string
  city: string
  postal_code: string
} {
  const province = getVnProvince(provinceCode)
  const ward = getVnWard(wardCode)
  if (!province || !ward || ward.province_code !== province.code) {
    throw new Error(`Unknown ward ${wardCode} in province ${provinceCode}`)
  }
  const ref: VnAddressRef = { scheme: VN_ADDRESS_SCHEME, province_code: province.code, ward_code: ward.code }
  if (geo !== undefined) {
    if (!isGeoPoint(geo)) {
      throw new Error("Invalid geo point")
    }
    ref.geo = { lat: geo.lat, lng: geo.lng }
  }
  return {
    metadata: { [VN_ADDRESS_METADATA_KEY]: ref },
    province: province.full_name,
    city: ward.full_name,
    postal_code: ward.postal_code,
  }
}

const UNIT_PREFIXES = [
  "thanh pho truc thuoc trung uong",
  "thanh pho",
  "tinh",
  "phuong",
  "xa",
  "dac khu",
  "thi tran",
  "tp",
]

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
}

function clean(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,;:()\-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b0+(\d)/g, "$1") // "Phường 01" = "Phường 1"
}

function stripPrefix(s: string): string {
  const plain = stripAccents(s)
  for (const prefix of UNIT_PREFIXES) {
    if (plain.startsWith(prefix + " ")) {
      // Prefixes have the same length with or without accents.
      return s.slice(prefix.length + 1)
    }
  }
  return s
}

/**
 * Lower-case, accent-free, prefix-free form of a place name:
 * "Phường Đống Đa" -> "dong da". Several wards share the same folded name
 * (e.g. "Xã Văn Lang" / "Xã Văn Lăng"), so use it only as a last resort.
 */
export function normalizeVnName(input: string): string {
  return stripAccents(stripPrefix(clean(input)))
}

/**
 * Finds a ward of a province by any of the given names (carrier name, aliases).
 * Tries, in order: full name with accents ("phường ba đình"), short name with
 * accents ("ba đình"), short name without accents ("ba dinh"). A tier that
 * matches more than one ward stops the search: callers must not guess.
 */
export function matchVnWard(provinceCode: string, names: readonly string[]): VnWard | undefined {
  const inputs = names.map(clean).filter(Boolean)
  if (!inputs.length) {
    return undefined
  }
  const wards = listVnWards(provinceCode)
  const tiers: [(w: VnWard) => string, (s: string) => string][] = [
    [(w) => clean(w.full_name), (s) => s],
    [(w) => stripPrefix(clean(w.name)), stripPrefix],
    [(w) => stripAccents(stripPrefix(clean(w.name))), (s) => stripAccents(stripPrefix(s))],
  ]
  for (const [wardKey, inputKey] of tiers) {
    const wanted = new Set(inputs.map(inputKey))
    const hits = wards.filter((w) => wanted.has(wardKey(w)))
    if (hits.length === 1) {
      return hits[0]
    }
    if (hits.length > 1) {
      return undefined
    }
  }
  return undefined
}
