# @teknixglobal/teknix-vietnam-payment-sepay-medusa-plugin

[SePay](https://sepay.vn) payment gateway for Medusa v2 (VND): VietQR bank transfer, NAPAS, cards, on SePay's hosted page. Provider id `pp_sepay_sepay`.

```ts
{ resolve: "@teknixglobal/teknix-vietnam-payment-sepay-medusa-plugin", id: "sepay", options: {
  env: "sandbox", merchant_id: process.env.SEPAY_MERCHANT_ID, secret_key: process.env.SEPAY_SECRET_KEY,
  ipn_secret_key: process.env.SEPAY_IPN_SECRET_KEY, return_url_origins: process.env.STORE_CORS,
} }
```

| Gateway facts (checked 2026-11-09, developer.sepay.vn) | |
|---|---|
| Sandbox | `pay-sandbox.sepay.vn`, `pgapi-sandbox.sepay.vn`; own merchant id + secret key; "Simulate payment" button |
| Checkout | POST signed form; HMAC-SHA256 over a fixed field list, base64 |
| Status | `GET /v1/order/detail/{invoice}` (Basic auth); `CAPTURED`, `CANCELLED`, `AUTHENTICATION_NOT_NEEDED` (unpaid) |
| IPN | POST JSON `ORDER_PAID`, optional `X-Secret-Key`; URL `/hooks/payment/sepay_sepay` |
| Refund | no API for paid orders: recorded in Medusa, paid back by hand |
| Return URLs | public hosts only (not `localhost`) |

Docs: [CONTRACT.md](https://github.com/teknixglobal/teknix-vietnam-commerce-plugins/blob/main/CONTRACT.md), [IPN behind a tunnel](https://github.com/teknixglobal/teknix-vietnam-commerce-plugins/blob/main/docs/IPN-TUNNEL.md).
