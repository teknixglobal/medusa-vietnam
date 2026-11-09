// Rebuilds src/data/vn-units.json from a pinned release of
// thanglequoc/vietnamese-provinces-database (MIT). Run: pnpm data:vn-units
// To move to a new release: change TAG and SHA256, run, review the diff, add a changeset.
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"

const TAG = "v5.2.0"
const SHA256 = "965c9a2ad85481e18ed2464fd87666eda311856b86a72a87f1130c27376b8d2f"
const BASE = `https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/${TAG}/json`

const fetchText = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

const raw = await fetchText(`${BASE}/full_json_generated_data_vn_units.json`)
const sha = createHash("sha256").update(raw).digest("hex")
if (sha !== SHA256) throw new Error(`sha256 mismatch: ${sha}`)
const meta = JSON.parse(await fetchText(`${BASE}/vn_provinces_metadata.json`))
const units = JSON.parse(raw)

const provinces = []
const wards = []
for (const p of units) {
  provinces.push([p.Code, p.Name, p.FullName, p.PostalCodePrefix ?? ""])
  for (const w of p.Wards) {
    if (w.ProvinceCode !== p.Code) throw new Error(`ward ${w.Code} province mismatch`)
    wards.push([w.Code, p.Code, w.Name, w.FullName, w.PostalCode ?? ""])
  }
}
provinces.sort((a, b) => a[0].localeCompare(b[0]))
wards.sort((a, b) => a[0].localeCompare(b[0]))

const out = {
  dataset: "thanglequoc/vietnamese-provinces-database",
  license: "MIT",
  version: meta.DatasetVersion,
  latest_decree: meta.LatestDecree,
  generated_at: meta.GeneratedAt,
  sha256: SHA256,
  provinces_columns: ["code", "name", "full_name", "postal_prefix"],
  wards_columns: ["code", "province_code", "name", "full_name", "postal_code"],
  provinces,
  wards,
}
const target = new URL("../src/data/vn-units.json", import.meta.url)
writeFileSync(target, JSON.stringify(out) + "\n")
console.log(`vn-units ${out.version}: ${provinces.length} provinces, ${wards.length} wards`)
