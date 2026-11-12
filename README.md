# teknix-vietnam-commerce-plugins (trước là medusa-vietnam, D-093)

Vietnamese payment gateways for [Medusa](https://medusajs.com) v2 (tested on 2.22.3), usable with plain Medusa and [Mercur](https://github.com/mercurjs/mercur). One package per gateway, shared helpers in `core`.
Cổng thanh toán Việt Nam cho Medusa v2 (đã thử trên 2.22.3), dùng được với Medusa thường và Mercur. Mỗi cổng một gói, phần dùng chung nằm trong `core`.

| Package | Gateway | Status |
|---|---|---|
| [`@teknixglobal/teknix-vietnam-payment-cod-medusa-plugin`](packages/payment-cod) | Cash on delivery | ready |
| [`@teknixglobal/teknix-vietnam-payment-sepay-medusa-plugin`](packages/payment-sepay) | SePay: VietQR, NAPAS, card | ready, sandbox verified 2026-11-09 |
| `@teknixglobal/teknix-vietnam-payment-vnpay-medusa-plugin` | VNPay | next |
| `@teknixglobal/teknix-vietnam-payment-payos-medusa-plugin` | payOS | later |
| [`@teknixglobal/teknix-vietnam-commerce-medusa-plugin`](packages/commerce) | optional plugin: `GET /store/vietnam-payments/methods` (vi/en labels) | ready |
| [`@teknixglobal/teknix-vietnam-core`](packages/core) | shared helpers, installed as a dependency | ready |

- Integration contract (config, env, storefront `next_action`, return flow, refunds): [CONTRACT.md](CONTRACT.md)
- Webhooks behind Cloudflare Tunnel + Access: [docs/IPN-TUNNEL.md](docs/IPN-TUNNEL.md)
- Adding a new gateway (checklist, rules per method, tests, lessons): [docs/ADDING-A-GATEWAY.md](docs/ADDING-A-GATEWAY.md)

## Quick start

```bash
npm i @teknixglobal/teknix-vietnam-payment-cod-medusa-plugin @teknixglobal/teknix-vietnam-payment-sepay-medusa-plugin
```

Register the providers in `medusa-config.ts` (CONTRACT.md section 1), set the env variables, restart, then enable the providers on your region in Admin.
Khai báo provider trong `medusa-config.ts` (CONTRACT.md mục 1), điền biến môi trường, khởi động lại, rồi bật provider cho region trong Admin.

The storefront reads `payment_session.data.next_action` and posts a form, redirects, or completes the cart. Reference implementation for the Medusa Next.js starter: YaahSport demo shop, `payment-button/vn-gateway-payment-button.tsx` and `app/api/payment-return/route.ts`.

## How payments are confirmed

- The redirect back to the shop proves nothing: completing the cart makes the provider ask the gateway API, and the paid amount must equal the signed amount.
- IPN/webhooks go through Medusa's `/hooks/payment/<provider>` and are re-checked against the gateway API before Medusa captures and completes the cart.

## Develop / Phát triển

Everything runs in a container (no Node on the host):

```bash
docker compose run --rm dev pnpm install
docker compose run --rm dev pnpm test          # unit tests, all packages
docker compose run --rm dev pnpm build         # core first, then gateways
docker compose run --rm dev pnpm typecheck
docker compose run --rm dev pnpm publish:local # yalc store shared with the test shop
```

Test shop (backend dir): `npx yalc add @teknixglobal/teknix-vietnam-core @teknixglobal/teknix-vietnam-payment-cod-medusa-plugin @teknixglobal/teknix-vietnam-payment-sepay-medusa-plugin`. Until `core` is on npm, the shop needs a pnpm override pointing `@teknixglobal/teknix-vietnam-core` at `file:./apps/backend/.yalc/@teknixglobal/teknix-vietnam-core`.

Releases use [changesets](https://github.com/changesets/changesets): `pnpm changeset`, `pnpm version`, `pnpm release`.

## License

MIT
