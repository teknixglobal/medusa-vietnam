# CONTRACT · medusa-vietnam

The interface between the packages of this repo, a Medusa backend, and a storefront. Changing anything here is a breaking change for every gateway package (minor bump while < 1.0).

| Package | Role |
|---|---|
| `@teknixglobal/medusa-vietnam-core` | Shared helpers (not installed directly) |
| `@teknixglobal/medusa-payment-cod` | COD provider |
| `@teknixglobal/medusa-payment-sepay` | SePay provider |
| `@teknixglobal/medusa-payment-vnpay` | VNPay provider + IPN/return routes (a Medusa plugin) |
| `@teknixglobal/medusa-vietnam` | Optional plugin: store route with vi/en labels |
| `@teknixglobal/medusa-vietnam-shipping-core` | Shipping helpers: carrier contract, 2025 VN address data (not installed directly) |
| `@teknixglobal/medusa-fulfillment-ghn` | GHN fulfillment provider + webhook, sync job, address store routes (a Medusa plugin) |

Payments: sections 1-8. Shipping: section 9.

## 1. Install

```bash
npm i @teknixglobal/medusa-payment-cod @teknixglobal/medusa-payment-sepay @teknixglobal/medusa-payment-vnpay
npm i @teknixglobal/medusa-vietnam   # optional: GET /store/vietnam-payments/methods
```

```ts
// medusa-config.ts
plugins: [
  { resolve: "@teknixglobal/medusa-vietnam", options: {} },        // optional
  { resolve: "@teknixglobal/medusa-payment-vnpay", options: {} },  // VNPay: registers /hooks/vnpay/*
],
modules: [{
  resolve: "@medusajs/medusa/payment",
  options: { providers: [
    { resolve: "@teknixglobal/medusa-payment-cod", id: "cod", options: { max_amount: 5000000 } },
    { resolve: "@teknixglobal/medusa-payment-sepay", id: "sepay", options: {
        env: process.env.SEPAY_ENV,                    // sandbox | production
        merchant_id: process.env.SEPAY_MERCHANT_ID,
        secret_key: process.env.SEPAY_SECRET_KEY,
        ipn_secret_key: process.env.SEPAY_IPN_SECRET_KEY, // optional
        return_url_origins: process.env.STORE_CORS,     // origins allowed in data.return_url
        payment_method: process.env.SEPAY_PAYMENT_METHOD, // optional: CARD | BANK_TRANSFER | NAPAS_BANK_TRANSFER
    } },
    { resolve: "@teknixglobal/medusa-payment-vnpay/providers/vnpay", id: "vnpay", options: {
        env: process.env.VNPAY_ENV,                    // sandbox | production
        tmn_code: process.env.VNPAY_TMN_CODE,
        hash_secret: process.env.VNPAY_HASH_SECRET,
        backend_url: process.env.MEDUSA_BACKEND_URL,   // public URL of this server (return route)
        payment_url: process.env.VNPAY_PAYMENT_URL,    // production only, from the VNPay contract
        api_url: process.env.VNPAY_API_URL,            // production only, from the VNPay contract
        return_url_origins: process.env.STORE_CORS,
    } },
  ] },
}]
```

Then enable the providers on the region (Admin > Settings > Regions, or `updateRegionsWorkflow`).

| Provider | `provider_id` | Currency | Capture |
|---|---|---|---|
| COD | `pp_cod_cod` | VND | Authorized at checkout; capture in Admin when the cash is collected |
| SePay | `pp_sepay_sepay` | VND | Captured when SePay reports `CAPTURED` |
| VNPay | `pp_vnpay_vnpay` | VND | Captured on a signed paid callback (return or IPN, recorded by the plugin routes), else when querydr reports `vnp_TransactionStatus=00` |

## 2. Environment variables (backend)

| Name | Required | Notes |
|---|---|---|
| `SEPAY_ENV` | yes | `sandbox` or `production`; each has its own merchant id + key |
| `SEPAY_MERCHANT_ID`, `SEPAY_SECRET_KEY` | yes | my.sepay.vn > Payment Gateway. The key is shown once |
| `SEPAY_IPN_SECRET_KEY` | no | IPN tab, auth type SECRET_KEY. Checked against the `X-Secret-Key` header |
| `SEPAY_PAYMENT_METHOD` | no | Empty: the customer chooses on the SePay page |
| `COD_MAX_AMOUNT` | no | VND; COD refused above it |
| `VNPAY_ENV` | yes | `sandbox` or `production`; each has its own TMN code + hash secret |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | yes | Sandbox: register at sandbox.vnpayment.vn/devreg, sent by email |
| `MEDUSA_BACKEND_URL` | yes (VNPay) | Public https URL of the backend; VNPay returns to `<it>/hooks/vnpay/return` |
| `VNPAY_PAYMENT_URL`, `VNPAY_API_URL` | production | Given by VNPay when going live; sandbox URLs are built in |

## 3. Creating the payment session (storefront)

`POST /store/payment-collections/:id/payment-sessions`

```json
{ "provider_id": "pp_sepay_sepay",
  "data": { "return_url": "https://shop.example/api/payment-return?cart_id=...&country_code=vn", "locale": "vi" } }
```

- `return_url` must be on an origin listed in `return_url_origins`. The provider appends `provider=<code>&result=success|error|cancel`. SePay only redirects to public hosts (not `localhost`).
- `locale`: `vi` or `en` (any `vi-*` / `en-*` works). Sets the gateway page language.
- VNPay only, optional: `bank_code` (`VNPAYQR` | `VNBANK` | `INTCARD`, skips VNPay's method page) and `client_ip` (the customer's IP for `vnp_IpAddr`; default `127.0.0.1`). Malformed values are ignored.

## 4. `payment_session.data.next_action`

| `type` | Storefront does | Providers |
|---|---|---|
| `form_post` | Build a `<form method="POST" action={url}>` with `fields` (ordered `[name, value]` pairs, keep the order) and submit it | SePay |
| `redirect` | `window.location.assign(url)` | VNPay |
| `qr` | Show `image_url` / `content`, poll the cart, then complete it | (reserved: payOS, SePay VietQR) |
| `none` | Complete the cart directly | COD |

`next_action` is `null` once the session is paid or cancelled.

## 5. Return and completion

1. The gateway sends the customer to `return_url` with `result`.
2. `result=success`: the storefront completes the cart (`POST /store/carts/:id/complete`). The provider's `authorizePayment` asks the gateway API for the real status and compares the paid amount with the signed amount; the redirect itself proves nothing.
3. `result=cancel`: back to the payment step. `result=error`: show an error.
4. VNPay has one return URL with its own codes, so it returns to the backend (`GET /hooks/vnpay/return`), which checks the signature and redirects (303) to the session's `return_url` with the same `provider=vnpay&result=...`. The storefront needs no VNPay-specific code.
5. Webhook / IPN: `POST /hooks/payment/sepay_sepay` (Medusa standard route; behind Cloudflare Access see docs/IPN-TUNNEL.md). The plugin re-reads the order from the SePay API before acting, then Medusa's `processPaymentWorkflow` captures the payment and completes the cart even if the customer never came back.
   VNPay: `GET /hooks/vnpay/ipn` (set as IPN URL in the VNPay merchant portal). It answers VNPay's `{"RspCode","Message"}` (00 ok, 01 unknown order, 02 already confirmed, 04 wrong amount, 97 bad checksum, 99 error) and hands paid IPNs to the same Medusa pipeline.

## 6. Store API

`GET /store/vietnam-payments/methods?region_id=reg_...&locale=vi` (publishable key required; needs the optional `@teknixglobal/medusa-vietnam` plugin)

```json
{ "locale": "vi", "payment_methods": [
  { "provider_id": "pp_cod_cod", "code": "cod", "flow": "offline",
    "label": "Thanh toán khi nhận hàng (COD)", "description": "..." } ] }
```

Locale: `?locale`, else `Accept-Language`, else `vi`.

## 7. Refunds

- COD: recorded in Medusa; pay back by hand.
- SePay: SePay has no refund API for paid orders. `refundPayment` records the refund in Medusa (`data.sepay.refunds`) and logs a warning; transfer the money back by hand. Set `refund_mode: "disabled"` to block refunds instead.
- VNPay: refund API (`vnp_TransactionType` 02 full / 03 partial), `data.vnpay.refunds`. `refund_mode: "manual"` records only; `"disabled"` refuses. VNPay processes refunds asynchronously (querydr status 05/06).
- Partial refunds are supported (needed for Mercur per-seller refunds).

## 8. Out of scope

Tax, e-invoices, promotions, commissions/affiliate, Mercur payouts. They listen to `payment.captured` / `payment.refunded`.

## 9. Shipping

Install and options: `packages/fulfillment-ghn/README.md`. Carrier packages share `shipping-core`; a new carrier follows the same contract.

| Item | Contract |
|---|---|
| Provider | `@teknixglobal/medusa-fulfillment-ghn/providers/ghn`, id `ghn` → `provider_id` `ghn_ghn`. Plugin `@teknixglobal/medusa-fulfillment-ghn` registers the routes, workflow, job and subscriber |
| Shipping options | `ghn-standard`, `ghn-heavy`, `ghn-return`; `price_type: "calculated"` |
| Price | Carrier quote, cached; when the carrier fails, `fallback_amount` is shown and checkout is not blocked (omit it to block instead) |
| Address | `shipping_address.metadata.vn_address = { scheme: "2025", province_code, ward_code, geo? }` with NSO codes (34 provinces, no district). `province` / `city` are display only. Required by `validateFulfillmentData` |
| Phone | `shipping_address.phone`, a valid Vietnamese number; `createFulfillment` refuses the order without it (storefronts should require it for `vn`) |
| COD | `order.metadata.vn_shipping_cod_amount` (VND integer), written on `order.placed` for `pp_cod_*` payments. Missing = prepaid (COD 0) |
| COD capture | Option `capture_cod_on_delivery` (default off): the COD payment is captured once the carrier itself reported the delivery of every live fulfillment and the carrier COD equals the payment. Result in `order.metadata.vn_cod_capture = { status: "captured" \| "blocked" \| "failed", reason?, amount?, fulfillment_id, at }`; blocked/failed are captured by hand in Admin |
| Declared value | Option `declare_value` (default off): carrier insurance on `unit_price × quantity` of the shipped items, capped (`insurance_max`, GHN ≤ 5 000 000). `fulfillment.data.ghn_insurance_value` |
| Status | `fulfillment.data.ghn_status`, `shipment_status`, `shipment_flag` (needs attention), `ghn_reason`, `ghn_reason_code`. Picked up → Medusa shipment; delivered → Medusa delivered. Never moves back from a final status |
| Webhook | `POST /hooks/ghn`, header `X-Teknix-Webhook-Secret: <webhook_secret>` (or `webhook_header`). Payloads are unsigned: the order is always re-read from GHN. 503 on temporary errors so GHN retries. Job `ghn-sync-shipments` every 30 min covers missed webhooks |
| Store API | `GET /store/vn-address/provinces` → `{ provinces: [{ code, name, full_name }], dataset }`; `GET /store/vn-address/provinces/:code/wards` → `{ wards: [{ code, name, full_name, postal_code }] }` (publishable key) |
| Admin API | `GET /admin/ghn/fulfillments/:id/label?format=A5\|80x80\|52x70` → `{ url }` (~30 min); `POST /admin/ghn/fulfillments/:id/sync` |
| Out of scope | Refunding payments; capturing anything but COD after delivery (prepaid gateways capture themselves), return pickups (book in the GHN portal) |
