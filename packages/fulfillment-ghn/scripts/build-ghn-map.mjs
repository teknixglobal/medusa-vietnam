// Rebuilds src/data/ghn-map.json: NSO province/ward codes (shipping-core) -> GHN
// master-data v3 ids and names. Staging and production share the same ids.
// Needs a GHN token: GHN_ENV=staging|production GHN_TOKEN=... pnpm data:ghn-map
// Offline: GHN_FROM_DIR=<dir with prov.json and ward-<province_id>.json saved from the same endpoints>.
// Use the production catalogue: staging lags behind (5 ward names differed on 2026-11-09).
// Build shipping-core first (pnpm build). Fails if any unit does not match one-to-one.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  listVnProvinces,
  listVnWards,
  matchVnWard,
  normalizeVnName,
  VN_UNITS_DATASET,
} from "@teknixglobal/medusa-vietnam-shipping-core"

const env = process.env.GHN_ENV ?? "production"
const token = process.env.GHN_TOKEN
const fromDir = process.env.GHN_FROM_DIR
if (!token && !fromDir) throw new Error("GHN_TOKEN (or GHN_FROM_DIR) is required")
const base = env === "production" ? "https://online-gateway.ghn.vn" : "https://dev-online-gateway.ghn.vn"

function readSaved(path) {
  const file = path.includes("/ward/") ? `ward-${new URL("http://x" + path).searchParams.get("province_id")}.json` : "prov.json"
  const body = JSON.parse(readFileSync(join(fromDir, file), "utf8").replace(/[\u0000-\u001f]/g, " "))
  if (body.code !== 200) throw new Error(`${file}: ${body.code} ${body.message}`)
  return body.data
}

async function get(path) {
  if (fromDir) return readSaved(path)
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(base + path, { headers: { Token: token } })
      const text = (await res.text()).replace(/[\u0000-\u001f]/g, " ")
      const body = JSON.parse(text)
      if (body.code !== 200) throw new Error(`${path}: ${body.code} ${body.message}`)
      return body.data
    } catch (error) {
      if (attempt >= 4) throw error
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
}

const ghnProvinces = await get("/shiip/public-api/v3/master-data/province/all?offset=0&limit=100")
const provinces = {}
const wards = {}
const problems = []

for (const gp of ghnProvinces) {
  const names = new Set([gp.name, ...(gp.extension_names ?? [])].map(normalizeVnName))
  const hits = listVnProvinces().filter((p) => names.has(normalizeVnName(p.name)))
  if (hits.length !== 1) {
    problems.push(`province ${gp._id} ${gp.name}: ${hits.length} matches`)
    continue
  }
  const nso = hits[0].code
  provinces[nso] = [gp._id, gp.name]
  const ghnWards = await get(`/shiip/public-api/v3/master-data/ward/all-by-province-id?province_id=${gp._id}&limit=500`)
  for (const gw of ghnWards ?? []) {
    if (gw.status !== 1) continue
    const ward =
      matchVnWard(nso, [gw.name, ...(gw.extension_names ?? [])]) ?? matchVnWard(nso, [gw.name])
    if (!ward) {
      problems.push(`ward ${gw._id} ${gw.name} (${gp.name}): no unique match`)
    } else if (wards[ward.code]) {
      problems.push(`ward ${ward.code} ${ward.full_name}: matched twice`)
    } else {
      wards[ward.code] = [gw._id, gw.name]
    }
  }
}

const expectedWards = listVnProvinces().reduce((n, p) => n + listVnWards(p.code).length, 0)
for (const p of listVnProvinces()) {
  if (!provinces[p.code]) problems.push(`NSO province ${p.code} ${p.name}: no GHN province`)
  for (const w of listVnWards(p.code)) if (!wards[w.code]) problems.push(`NSO ward ${w.code} ${w.full_name}: no GHN ward`)
}
if (problems.length) {
  console.error(problems.join("\n"))
  throw new Error(`${problems.length} problems: map not written`)
}

const out = {
  source: `GHN master-data v3 (${env}${fromDir ? ", saved copy" : ""})`,
  generated_at: new Date().toISOString(),
  vn_units_version: VN_UNITS_DATASET.version,
  columns: ["ghn_id", "ghn_name"],
  provinces,
  wards,
}
writeFileSync(new URL("../src/data/ghn-map.json", import.meta.url), JSON.stringify(out) + "\n")
console.log(`ghn-map: ${Object.keys(provinces).length} provinces, ${Object.keys(wards).length}/${expectedWards} wards`)
