# Adding a gateway

How to add a Vietnamese payment gateway to this monorepo (VNPay, payOS, MoMo, ZaloPay...). SePay (`packages/sepay`) is the reference implementation; COD (`packages/cod`) is the minimal one.

## 0. Before writing code: fill this table

Read the gateway docs and write the answers into the package README. Every later step depends on them.

| Question | SePay (example) |
|---|---|
| Sandbox? How do you get credentials? | Yes, separate env, merchant id + secret key on my.sepay.vn |
| How does the customer pay? (redirect URL / POST form / QR shown in shop) | POST signed form to `pay(-sandbox).sepay.vn/v1/checkout/init` |
| Signing: algorithm, which fields, order, encoding | HMAC-SHA256, fixed field list, `k=v` joined by `,`, base64 |
| Amount unit | VND (whole dong) |
| Unique order reference and its limits | `order_invoice_number`, unique; we use the Medusa session id |
| Return URL behaviour, public host required? | success/error/cancel URLs, public host only |
| Status query API | `GET /v1/order/detail/{invoice}`, Basic auth |
| IPN/webhook: method, body, auth | POST JSON, optional `X-Secret-Key` header |
| Cancel / void / refund APIs | cancel (unpaid QR only), void (card), no refund API |
| Official SDK? Licence, last release | `sepay-pg-node` (MIT); not used: signing is 20 lines and the SDK keeps base URLs in static state |

## 1. Scaffold

```bash
cp -r packages/cod packages/<code>       # then rename
```

- `package.json`: name `@teknixglobal/medusa-payment-<code>`, dependency `@teknixglobal/medusa-vietnam-core: workspace:^`, peer `@medusajs/framework: ~2.22.3`. Gateway SDKs go in this package only, never in core.
- `src/index.ts`: `export default ModuleProvider(Modules.PAYMENT, { services: [Service] })`.
- `static identifier = "<code>"` -> provider id `pp_<code>_<id>`.
- Add labels in `packages/core/src/i18n.ts` (`METHOD_INFO`, vi + en, `flow`).

## 2. Provider methods: what each one must do

| Method | Rule |
|---|---|
| `validateOptions` | Throw `INVALID_DATA` for missing credentials so a bad config fails at boot |
| `initiatePayment` | `assertVnd`, `toVndInteger`, take `data.session_id` as the gateway reference, check `data.return_url` with `resolveReturnUrl`, return `data.next_action` (see CONTRACT.md 4) and status `pending`. Store the signed amount in `data.<code>.amount` |
| `updatePayment` | Re-sign only if the caller passed the stored data and the amount changed; otherwise return the data unchanged. **Never `{ data: {} }`**: Medusa stores the returned data as the whole session data |
| `authorizePayment` | **Ask the gateway API**. Return `captured` for gateways that capture on payment, `authorized` for real auth/capture flows, `pending` when unpaid (Medusa then refuses to complete the cart), `error` when the paid amount differs from the signed amount |
| `capturePayment` | No-op for capture-on-payment gateways |
| `refundPayment` | Call the refund API, or record a manual refund in `data` and log a warning. Must support partial amounts (Mercur refunds per seller) |
| `cancelPayment` / `deletePayment` | Best effort cancel of an unpaid gateway order; never throw on "not found" |
| `getPaymentStatus` / `retrievePayment` | Same API call as authorize |
| `getWebhookActionAndData` | Parse, then **re-read the order from the API**; return `{ action: "captured", data: { session_id, amount } }` or `not_supported`. Never trust the body alone |

## 3. Webhooks / IPN

- Medusa's route is `POST /hooks/payment/<identifier>_<id>` (e.g. `/hooks/payment/sepay_sepay`). It answers `200 OK` at once and processes 5 s later (`payment.webhook_received` -> `processPaymentWorkflow`), which authorizes, captures and **completes the cart** even if the customer never comes back.
- If the gateway needs a specific response body (VNPay wants `{"RspCode":"00","Message":"..."}`) or calls with **GET** (VNPay IPN is GET with query params), the built-in route cannot serve it. Ship the package as a Medusa plugin with its own route (e.g. `GET /hooks/vnpay/ipn`) that verifies, answers the gateway format, then runs `processPaymentWorkflow` with `{ action, data: { session_id, amount } }`.
- Map the gateway reference back to the session: keep the session id inside the reference (`<session_id>` or `<session_id>-<attempt>`).

## 4. Storefront

Only `next_action` matters. Existing types: `form_post`, `redirect`, `qr`, `none`. A new type means a new storefront component, so prefer an existing one.
The return URL lands on `/api/payment-return?provider=<code>&result=success|error|cancel`; on success the storefront completes the cart, which calls `authorizePayment`.

## 5. Tests (required before merge)

- Unit (`src/__tests__/*.unit.spec.ts`): the signing example from the gateway docs byte for byte; amount mismatch -> `error`; webhook with bad secret and with an unpaid order -> `not_supported`; webhook with a paid order -> `captured` with the right session id; return URL on a foreign origin rejected.
- Sandbox E2E on the test shop (YaahSport): pay, unpaid complete refused, cancel and pay again, partial refund, IPN without the customer returning (point `return_url` at a decoy cart id, then send the IPN).

## 6. Release

```bash
pnpm changeset          # pick the package, minor for a new gateway
pnpm version && git commit -am "release"
pnpm release            # build + npm publish (needs npm login to the teknixglobal org)
```

## Lessons from SePay

- Docs and SDK disagreed on signing order (docs: fixed list; SDK: object key order). Follow the docs list and post the form fields in the same order; verified on sandbox 2026-11-09.
- Session `data` is Postgres `jsonb`: object key order is lost. Keep ordered things (form fields) as `[name, value]` arrays.
- `order_amount` comes back as `"1636500.00"`: compare with `Number()`.
- Gateways redirect only to public hosts: test through the tunnel domain, not `localhost`.
- Behind a tunnel, Next.js `req.nextUrl.origin` is `localhost:8000`; build redirect URLs from `x-forwarded-host` (allow-listed).
- SePay's "cancel" button only redirects; the order can still be paid with the same invoice afterwards.

## Lessons from VNPay

- Gateways with a GET IPN or a required response body: ship the package as a plugin with the provider under `src/providers/<code>` (resolve `<pkg>/providers/<code>`) plus routes under `src/api/hooks/<code>/`. The routes call `paymentModule.getWebhookActionAndData({ provider: "pp_<code>_<id>" })` so the secret stays in the provider, then emit `payment.webhook_received` like Medusa's own route.
- One return URL with gateway codes: return to the backend (`/hooks/<code>/return`), verify, redirect to the stored `return_url` with `result=...`. The storefront stays gateway-agnostic, and the redirect target comes from the DB, not the query (no open redirect).
- Reference charset: VNPay wants alphanumeric; Medusa ids have `_`. Use the ULID part and map back.
- Dates in GMT+7: build them from UTC + 7h, never from the server's local time.
- Read the SDK before using it: `vnpay` 2.5.2 looked fine but had 4 defects (see packages/vnpay/README.md). Its output is still a useful cross-check vector in tests.
- Sandbox E2E 2026-11-09: payment URL, return and IPN signatures verified with real VNPay transactions (orders #10, #11, cancel 24). The querydr/refund API answered `99 Unexpected error` to everything (even wrong checksum/TMN, even via the SDK): don't make a status API the only proof. A signed callback recorded on the session (route -> workflow -> `updatePaymentSession` -> provider `updatePayment` checks the signature) is enough; the status API is the fallback.
- Error answers from VNPay's API are unsigned: accept unsigned non-00 answers (they can only mean pending/error), never an unsigned 00.
- `updatePayment` returning `{ data: {} }` wipes the session data (Medusa replaces it). SePay and VNPay had this; fixed.
