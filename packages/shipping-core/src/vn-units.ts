import data from "./data/vn-units.json"

/** Province (tỉnh/thành phố) after the 2025 reorganisation. */
export type VnProvince = {
  code: string
  /** Short name, e.g. "Hà Nội". */
  name: string
  /** With unit prefix, e.g. "Thành phố Hà Nội". */
  full_name: string
  /** Comma-separated 2-digit postal prefixes. */
  postal_prefix: string
}

/** Ward-level unit (phường, xã, đặc khu): the lowest tier, directly under a province. */
export type VnWard = {
  code: string
  province_code: string
  /** Short name, e.g. "Ba Đình". */
  name: string
  /** With unit prefix, e.g. "Phường Ba Đình". */
  full_name: string
  postal_code: string
}

type Dataset = {
  version: string
  latest_decree: string
  generated_at: string
  sha256: string
  provinces: [string, string, string, string][]
  wards: [string, string, string, string, string][]
}

const dataset = data as unknown as Dataset

/** Where the bundled administrative-unit data comes from. */
export const VN_UNITS_DATASET = Object.freeze({
  source: "thanglequoc/vietnamese-provinces-database (MIT), from danhmuchanhchinh.nso.gov.vn",
  version: dataset.version,
  latest_decree: dataset.latest_decree,
  generated_at: dataset.generated_at,
})

const provinces: VnProvince[] = dataset.provinces.map(([code, name, full_name, postal_prefix]) =>
  Object.freeze({ code, name, full_name, postal_prefix })
)
const provinceByCode = new Map(provinces.map((p) => [p.code, p]))

const wardByCode = new Map<string, VnWard>()
const wardsByProvince = new Map<string, VnWard[]>()
for (const [code, province_code, name, full_name, postal_code] of dataset.wards) {
  const ward: VnWard = Object.freeze({ code, province_code, name, full_name, postal_code })
  wardByCode.set(code, ward)
  const list = wardsByProvince.get(province_code)
  if (list) {
    list.push(ward)
  } else {
    wardsByProvince.set(province_code, [ward])
  }
}

export function listVnProvinces(): readonly VnProvince[] {
  return provinces
}

export function getVnProvince(code: string | undefined | null): VnProvince | undefined {
  return code ? provinceByCode.get(code) : undefined
}

export function listVnWards(provinceCode: string): readonly VnWard[] {
  return wardsByProvince.get(provinceCode) ?? []
}

export function getVnWard(code: string | undefined | null): VnWard | undefined {
  return code ? wardByCode.get(code) : undefined
}
