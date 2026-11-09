# @teknixglobal/medusa-payment-vnpay

[VNPay](https://vnpay.vn) payment gateway for Medusa v2 (VND): VNPAY-QR, domestic ATM / internet banking, international cards, on VNPay's hosted page. Provider id `pp_vnpay_vnpay`.

It is a Medusa **plugin** (VNPay calls the IPN with GET and wants a JSON `RspCode` answer, which Medusa's built-in webhook route cannot give), so register it twice:

```ts
plugins: [{ resolve: "@teknixglobal/medusa-payment-vnpay", options: {} }],   // routes /hooks/vnpay/*
modules: [{ resolve: "@medusajs/medusa/payment", options: { providers: [
  { resolve: "@teknixglobal/medusa-payment-vnpay/providers/vnpay", id: "vnpay", options: {
    env: "sandbox", tmn_code: process.env.VNPAY_TMN_CODE, hash_secret: process.env.VNPAY_HASH_SECRET,
    backend_url: process.env.MEDUSA_BACKEND_URL, return_url_origins: process.env.STORE_CORS,
  } },
] } }]
```

Merchant portal: IPN URL = `<backend_url>/hooks/vnpay/ipn`. Both `/hooks/vnpay/*` routes must be reachable from the internet (behind Cloudflare Access: bypass `/hooks`, see docs/IPN-TUNNEL.md).

| Gateway facts (checked 2026-11-09, sandbox.vnpayment.vn/apis/docs) | |
|---|---|
| Sandbox | `sandbox.vnpayment.vn`; TMN code + hash secret by email after registering at `/devreg`; NCB test card in the docs |
| Checkout | GET redirect to `paymentv2/vpcpay.html`; sorted `vnp_*` params, form-urlencoded, HMAC-SHA512 hex; `vnp_Amount` = VND x 100; dates `yyyyMMddHHmmss` GMT+7 |
| Reference | `vnp_TxnRef` alphanumeric, unique per day: the session ULID (+ attempt number when the amount changes) |
| Status | `querydr` (POST JSON, `|`-joined checksum); `vnp_TransactionStatus` 00 paid, 01 incomplete, 02 failed, 05/06 refund in progress |
| IPN | GET, signed; answer `{"RspCode","Message"}`; retried on 01/04/97/99 up to 10 times, 5 min apart |
| Return URL | one URL, VNPay codes (`24` = cancelled); handled by `/hooks/vnpay/return` -> storefront `result=success|error|cancel` |
| Refund | API, full (`02`) or partial (`03`), processed asynchronously by VNPay |
| Production | payment and API URLs come with the VNPay contract: set `payment_url` and `api_url` |
| SDK | `vnpay` (npm, MIT) not used: local-timezone dates, broken refund response check, non constant-time compare, no timeout. Its output is used as a cross-check in the tests |

Options: `env`, `tmn_code`, `hash_secret`, `backend_url` (required); `payment_url`, `api_url` (production); `return_url_origins`, `return_url`, `lang`, `order_type` (`other`), `order_info_prefix`, `expire_minutes` (15), `bank_code`, `refund_mode` (`api` | `manual` | `disabled`), `refund_created_by` (`medusa`), `server_ip`, `timeout_ms`.

Docs: [CONTRACT.md](https://github.com/teknixglobal/medusa-vietnam/blob/main/CONTRACT.md).
