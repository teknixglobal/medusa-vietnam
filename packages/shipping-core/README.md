# @teknixglobal/teknix-vietnam-shipping-core

Shared core for Vietnamese shipping carriers on Medusa v2 (2.22.3), used by the carrier packages in [teknix-vietnam-commerce-plugins](https://github.com/teknixglobal/teknix-vietnam-commerce-plugins) (GHN first). You install a carrier package, not this one.

| Export | What it is for |
|---|---|
| `CarrierAdapter`, `CarrierCapabilities`, request/result types | The contract every carrier package implements (quote, create, cancel, status, optional label/return, webhook verify + parse) |
| `ShipmentStatus`, `createStatusMapper`, `actionForStatus`, `canTransition` | Carrier-neutral statuses and what Medusa should do (mark shipped, mark delivered, flag) |
| `listVnProvinces`, `listVnWards`, `getVnWard`, `VN_UNITS_DATASET` | The 2025 two-tier map (34 provinces, 3321 wards, NSO codes, postal codes) bundled as JSON |
| `buildVnAddress`, `readVnAddress`, `matchVnWard`, `normalizeVnName` | `address.metadata.vn_address = { scheme: "2025", province_code, ward_code, geo? }` and name matching for carrier catalogues |
| `normalizeVnPhone` | 10-digit mobile / 11-digit landline, from `+84` and formatted input |
| `buildParcel`, `assertWithinCapabilities` | One parcel from cart/order items (grams, cm), checked against carrier limits |
| `quoteWithFallback`, `quoteCacheKey`, `MemoryTtlCache` | Checkout quotes: cache → carrier with timeout → fallback price (Medusa calls `calculatePrice` on every cart refresh; an error blocks checkout) |
| `verifySharedSecretHeader`, `WebhookDeduper` | Unsigned carrier webhooks: secret custom header, skip retries already handled |

## Addresses (2025 reorganisation)

Since 01/07/2025 Viet Nam has 34 provinces and no district tier. Store the codes, not only the names (units keep changing, e.g. 2026 resolutions):

```ts
const a = buildVnAddress("01", "00004")
// a.metadata = { vn_address: { scheme: "2025", province_code: "01", ward_code: "00004" } }
// a.province = "Thành phố Hà Nội", a.city = "Phường Ba Đình", a.postal_code = "11120"
```

`readVnAddress(address)` returns `null` for addresses without this metadata or with a ward that no longer belongs to the province: ask the customer to pick the ward again.

## Updating the administrative data

`pnpm --filter @teknixglobal/teknix-vietnam-shipping-core data:vn-units` downloads the pinned release, checks its sha256 and rewrites `src/data/vn-units.json`. To move to a new release, change `TAG` and `SHA256` in `scripts/build-vn-units.mjs`, run it, review the diff and add a changeset. Data licence: see `NOTICE`.
