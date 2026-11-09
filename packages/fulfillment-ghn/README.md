# @teknixglobal/medusa-fulfillment-ghn

GHN (Giao Hàng Nhanh) fulfillment provider for Medusa v2 (2.22.x), packaged as a plugin. Built on [`@teknixglobal/medusa-vietnam-shipping-core`](../shipping-core) and the 2025 two-tier address map (34 provinces, no district).

Status: 0.1.0, not published. Provider done and checked against GHN staging; status webhook, COD subscriber and storefront address form come next.

## What it does

| Medusa | GHN |
|---|---|
| `calculatePrice` (option `calculated`) | `shipping-order/preview` (dry run of create, the only GHN price API that accepts the new address model). Cached 1 h, fallback price on failure |
| `validateFulfillmentData` | Requires `shipping_address.metadata.vn_address` (province + ward, NSO codes) |
| `createFulfillment` | `shipping-order/create`, `client_order_code` = fulfillment id (GHN returns the same order on retry). COD from `order.metadata.vn_shipping_cod_amount` |
| `cancelFulfillment` | `switch-status/cancel` (per-order result checked: GHN answers HTTP 200 even when it refuses) |
| `retrieveDocuments(data, "label")` | `a5/gen-token` → HTML label link (A5), valid ~30 min, so it is fetched on demand |
| `createReturnFulfillment` | Recorded only; book the pickup in the GHN portal |

Options (`getFulfillmentOptions`): `ghn-standard` (service_type_id 2, < 20 kg), `ghn-heavy` (5), `ghn-return`.

## Install

```ts
// medusa-config.ts
plugins: [{ resolve: "@teknixglobal/medusa-fulfillment-ghn", options: {} }],
modules: [{
  resolve: "@medusajs/medusa/fulfillment",
  options: { providers: [
    { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
    { resolve: "@teknixglobal/medusa-fulfillment-ghn/providers/ghn", id: "ghn", options: {
      env: process.env.GHN_ENV,              // staging | production (tokens only work on their own gateway)
      token: process.env.GHN_TOKEN,
      shop_id: process.env.GHN_SHOP_ID,
      pickup: {                              // or put metadata.vn_address + phone on the stock location address
        name: "Kho", phone: "09xxxxxxxx", address_line: "Số nhà, đường",
        province_code: "01", ward_code: "00070",   // NSO codes, see shipping-core listVnWards
      },
      cod_max: Number(process.env.GHN_COD_MAX ?? 50000000), // production accounts may be far lower
      fallback_amount: 30000,                // shown when GHN fails; omit to block checkout instead
      webhook_secret: process.env.GHN_WEBHOOK_SECRET,
    } },
  ] },
}]
```

Provider id: `ghn_ghn`. Enable it on the stock location, then create a shipping option with `price_type: "calculated"` and option `ghn-standard`.

Other options: `payment_type_id` (1 shop pays GHN, default; 2 recipient pays), `required_note` (default `KHONGCHOXEMHANG`), `timeout_ms` (8000), `quote_timeout_ms` (4000), `quote_cache_ttl_seconds` (3600), `weight_unit` (`g`|`kg`, default g), `dimension_unit` (`cm`|`mm`), `default_item_weight_g` (500), `packaging_weight_g` (0).

## Addresses

GHN v3 master data uses its own ids. `src/data/ghn-map.json` maps every NSO ward to GHN's id and exact name (3321/3321, one-to-one, built from the production catalogue on 2026-11-09). Rebuild after a dataset update:

```bash
GHN_ENV=production GHN_TOKEN=... pnpm --filter @teknixglobal/medusa-fulfillment-ghn data:ghn-map
```

The script refuses to write a partial map. GHN's staging catalogue lags production (5 ward names differed on 2026-11-09), so build from production.

## Checked on the GHN API (2026-11-09)

- Production: catalogue, preview prices (Hà Nội inner 21 001 ₫, Hà Nội → HCM 39 000 ₫, 25 kg heavy 260 000 ₫). The fee does not depend on COD.
- Production account COD cap can be low (a new account: 300 000 ok, 400 000 `COD_IS_OVER_LIMIT`): set `cod_max`.
- Staging, through this adapter: preview, create, create again with the same reference (same order), detail, label, cancel twice, return refused on a cancelled order.
- Preview requires recipient name, a valid phone and an address line; quotes use placeholders while the cart has none.
