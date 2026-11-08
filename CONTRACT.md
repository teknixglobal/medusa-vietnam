# CONTRACT · medusa-vietnam

The interface between the packages of this repo, a Medusa backend, and a storefront. Changing anything here is a breaking change for every gateway package (minor bump while < 1.0).

| Package | Role |
|---|---|
| `@teknixglobal/medusa-vietnam-core` | Shared helpers (not installed directly) |
| `@teknixglobal/medusa-payment-cod` | COD provider |
| `@teknixglobal/medusa-payment-sepay` | SePay provider |
| `@teknixglobal/medusa-vietnam` | Optional plugin: store route with vi/en labels |

## 1. Install

```bash
npm i @teknixglobal/medusa-payment-cod @teknixglobal/medusa-payment-sepay
npm i @teknixglobal/medusa-vietnam   # optional: GET /store/vietnam-payments/methods
```

```ts
// medusa-config.ts
plugins: [{ resolve: "@teknixglobal/medusa-vietnam", options: {} }], // optional
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
  ] },
}]
```

Then enable the providers on the region (Admin > Settings > Regions, or `updateRegionsWorkflow`).

| Provider | `provider_id` | Currency | Capture |
|---|---|---|---|
| COD | `pp_cod_cod` | VND | Authorized at checkout; capture in Admin when the cash is collected |
| SePay | `pp_sepay_sepay` | VND | Captured when SePay reports `CAPTURED` |
| VNPay | `pp_vnpay_vnpay` | VND | (next release) |

## 2. Environment variables (backend)

| Name | Required | Notes |
|---|---|---|
| `SEPAY_ENV` | yes | `sandbox` or `production`; each has its own merchant id + key |
| `SEPAY_MERCHANT_ID`, `SEPAY_SECRET_KEY` | yes | my.sepay.vn > Payment Gateway. The key is shown once |
| `SEPAY_IPN_SECRET_KEY` | no | IPN tab, auth type SECRET_KEY. Checked against the `X-Secret-Key` header |
| `SEPAY_PAYMENT_METHOD` | no | Empty: the customer chooses on the SePay page |
| `COD_MAX_AMOUNT` | no | VND; COD refused above it |

## 3. Creating the payment session (storefront)

`POST /store/payment-collections/:id/payment-sessions`

```json
{ "provider_id": "pp_sepay_sepay",
  "data": { "return_url": "https://shop.example/api/payment-return?cart_id=...&country_code=vn", "locale": "vi" } }
```

- `return_url` must be on an origin listed in `return_url_origins`. The provider appends `provider=<code>&result=success|error|cancel`. SePay only redirects to public hosts (not `localhost`).
- `locale`: `vi` or `en` (any `vi-*` / `en-*` works). Sets the gateway page language.

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
4. Webhook / IPN: `POST /hooks/payment/sepay_sepay` (Medusa standard route; behind Cloudflare Access see docs/IPN-TUNNEL.md). The plugin re-reads the order from the SePay API before acting, then Medusa's `processPaymentWorkflow` captures the payment and completes the cart even if the customer never came back.

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
- Partial refunds are supported (needed for Mercur per-seller refunds).

## 8. Out of scope

Tax, e-invoices, promotions, commissions/affiliate, Mercur payouts. They listen to `payment.captured` / `payment.refunded`.
