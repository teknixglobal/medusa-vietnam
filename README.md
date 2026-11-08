# medusa-vietnam

Vietnamese payment providers for [Medusa](https://medusajs.com) v2 (tested on 2.22.3), usable with plain Medusa and [Mercur](https://github.com/mercurjs/mercur).
Cổng thanh toán Việt Nam cho Medusa v2 (đã thử trên 2.22.3), dùng được với Medusa thường và Mercur.

| Gateway | Status | Notes |
|---|---|---|
| COD (thanh toán khi nhận hàng) | ready | capture in Admin when cash is collected |
| SePay (VietQR, NAPAS, card) | ready, sandbox test pending | hosted payment page, IPN |
| VNPay | next | |
| payOS, MoMo, ZaloPay | later | |

Full integration contract: [CONTRACT.md](./CONTRACT.md).

## Install / Cài đặt

```bash
npm i @teknixglobal/medusa-vietnam   # or pnpm / yarn
```

Add the plugin and providers to `medusa-config.ts` (see CONTRACT.md section 1), set the env variables, run `medusa db:migrate`, then enable the providers on your region in Admin.
Thêm plugin và provider vào `medusa-config.ts` (CONTRACT.md mục 1), điền biến môi trường, chạy `medusa db:migrate`, rồi bật provider cho region trong Admin.

### SePay sandbox

1. Create an account at my.sepay.vn, open Payment Gateway, switch to Sandbox and copy the MERCHANT ID and SECRET KEY (shown once).
   Tạo tài khoản my.sepay.vn, vào Cổng thanh toán, chọn Sandbox, lấy MERCHANT ID và SECRET KEY (chỉ hiện một lần).
2. Put them in the backend `.env` as `SEPAY_MERCHANT_ID`, `SEPAY_SECRET_KEY`, with `SEPAY_ENV=sandbox`. Never commit them.
3. Optional IPN: set the IPN URL to `https://<your-backend>/hooks/payment/sepay_sepay`, auth type SECRET_KEY, and copy that key to `SEPAY_IPN_SECRET_KEY`. The URL must be public HTTPS.
4. Return URLs must be on a public host: test the storefront through a tunnel or a real domain, not `localhost`.

## Storefront

The storefront reads `payment_session.data.next_action` and either posts a form, redirects, or completes the cart (CONTRACT.md section 4). A reference implementation for the Medusa Next.js starter (`dtc-starter`) lives in the YaahSport demo shop: `payment-button/vn-gateway-payment-button.tsx` and `app/api/payment-return/route.ts`.

## Security

- Every gateway callback is re-checked against the gateway API; redirects and IPN bodies are not trusted.
- The paid amount must equal the signed amount, otherwise authorization fails.
- Return URLs are restricted to configured origins (`return_url_origins`).
- Secrets come from env only and are never logged.

## Develop / Phát triển

Everything runs in a container (no Node on the host):

```bash
docker compose run --rm dev pnpm install
docker compose run --rm dev pnpm test
docker compose run --rm dev pnpm build
docker compose run --rm dev pnpm publish:local   # yalc store shared with the test shop
```

In the test shop backend: `npx medusa plugin:add @teknixglobal/medusa-vietnam`.

## License

MIT
