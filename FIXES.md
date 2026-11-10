# Medusa behaviour fixes

Workarounds for Medusa core behaviour that our packages or projects depend on.
Each fix has an id (F-xxx), lives in exactly one place, and has a removal condition:
when you upgrade Medusa, check every open entry and remove the fix once the condition holds.

Where a fix goes (decision D-070):

| Scope | Place |
|---|---|
| Medusa behaviour that 2+ of our plugins rely on | `@teknixglobal/medusa-vietnam-core` (base classes, helpers) |
| Must run even when no provider plugin is installed (routes, middleware) | `@teknixglobal/medusa-vietnam` (plugin) |
| Project configuration and dependencies | template `teknix-ecom-template`: `withTeknix(config)` + `pnpm.overrides`, projects get it via `copier update` |
| Only one plugin cares | that plugin |

Rules: official extension points only (subclassing, config, workflow hooks, middleware, subscribers). No patching `node_modules`, no monkey-patching Medusa.

## Open

### F-001 · updatePayment must return the whole session data

- **Symptom:** after a cart total change or a callback recorded through `updatePaymentSession`, the payment session loses what `initiatePayment` stored (gateway reference, return URL, attempt). Authorize/capture then fail or see an empty session.
- **Cause:** `PaymentModuleService.updatePaymentSession` passes the caller's `data` to the provider and writes the provider's returned `data` as the whole `payment_session.data` (no merge). Returning `{}` or a partial object wipes the session.
- **Medusa versions:** seen on 2.22.3 (`@medusajs/payment` `dist/services/payment-module.js`, `updatePaymentSession`); 2.22.4 not checked yet. Documented provider contract, so likely by design rather than a bug.
- **Upstream issue:** none found (searched medusajs/medusa issues 2026-11-10). Not filed.
- **Fix:** `TeknixPaymentProviderBase` in `packages/core/src/payment-provider.ts` owns `updatePayment`; providers implement `updateSessionData` and return only a patch, which is merged over the stored data. `transientDataKeys` lists input-only keys that are never stored (VNPay: `vnpay_callback`). Helpers `splitSessionData` / `keepSessionData` for providers that cannot extend the base.
- **Used by:** cod, sepay, vnpay. A new payment provider must extend the base and must not override `updatePayment`.
- **Tests:** `packages/core/src/__tests__/payment-provider.unit.spec.ts`, `packages/cod/src/__tests__/cod.unit.spec.ts`, `updatePayment` cases in the sepay and vnpay specs.
- **Remove when:** Medusa merges provider data into the stored session data (or passes the stored data to `updatePayment` and documents partial returns). Then `updatePayment` can go back into each provider, or the base stays as a thin pass-through.

### F-002 · Translation module must be declared explicitly (project config)

- **Symptom:** `featureFlags: { translation: true }` (or the env flag) alone does not load the Translation module; store locales/translations are missing.
- **Cause:** on 2.22.3 `defineConfig()` checks the flag before `featureFlags` from the config is loaded, so the default module list skips Translation.
- **Medusa versions:** 2.22.3 (to re-check on 2.22.4).
- **Upstream issue:** none found (searched 2026-11-10).
- **Fix:** add `{ resolve: '@medusajs/medusa/translation' }` to `modules`. Today written by hand in each project's `medusa-config.ts` (YaahSport, template v0.1.x).
- **Place:** template `teknix-ecom-template`, `src/teknix/config.ts` `withTeknix(config)` — owned by the template thread.
- **Tests:** template QC (generate + upgrade) checks the module is registered.
- **Remove when:** a Medusa release loads Translation from `featureFlags` alone.

### F-003 · Admin must call the API on its own origin (project config)

- **Symptom:** admin opened on `localhost` while `MEDUSA_BACKEND_URL` points at a public domain calls the API on that domain; the session cookie is cross-site, login succeeds and every next call returns 401.
- **Cause:** admin uses `admin.backendUrl`, which defaults to the backend URL.
- **Medusa versions:** 2.22.x.
- **Upstream issue:** none found (searched 2026-11-10); arguably configuration, not a bug.
- **Fix:** `admin: { backendUrl: process.env.MEDUSA_ADMIN_BACKEND_URL || '/' }`. Today only in YaahSport (`fe618fa`); the template does not have it yet.
- **Place:** template `withTeknix(config)` — owned by the template thread.
- **Tests:** template QC: admin login on localhost and on the public domain.
- **Remove when:** never as a Medusa fix; keep as a template default.

### F-004 · Admin "Reset password" sends no email (project config)

- **Symptom:** admin "Reset password" says the email was sent, but nothing arrives; the log shows `Processing auth.password_reset ... 0 subscribers`.
- **Cause:** Medusa 2.22.x emits `auth.password_reset` but does not send the email itself; the default config only has `notification-local` on the `feed` channel, no `email` channel.
- **Medusa versions:** 2.22.x.
- **Upstream issue:** none; documented behaviour (the project must subscribe).
- **Fix:** subscriber on `auth.password_reset` sends a Notification on channel `email`, template `password-reset` (`data.url`, `email`, `actor_type`). Without an email provider: dev logs the link, production only reports an error (never logs the token). Admin link = `MEDUSA_ADMIN_URL` or `MEDUSA_BACKEND_URL` + `/app` (admin `backendUrl` is `/`, F-003); customer link = `STOREFRONT_URL` or the last entry of `STORE_CORS`. Source: YaahSport `apps/backend/src/subscribers/password-reset.ts` (`2edd0ec`).
- **Place:** template `teknix-ecom-template` (`src/subscribers`, projects get it from the template) — owned by the template thread.
- **Tests:** `POST /auth/user/emailpass/reset-password` → link in log → `POST /auth/user/emailpass/update` 200; old password 401; reused token 401 (checked 2026-11-10 on YaahSport).
- **Remove when:** never as a fix; once a real email provider is chosen, only add the template.
- **Note:** the dev server in the container does not reload on a new subscriber or `medusa-config` change made from macOS: restart the `app` container and fully reload the admin tab (an old tab keeps the old `backendUrl` and still gets 401).

## To check

- **GHN (`packages/fulfillment-ghn`, `packages/shipping-core`):** not on `main` yet (branch `feat/shipping-ghn`). After that PR merges, check whether GHN relies on Medusa behaviour that belongs here (e.g. a fulfillment provider base in core, like F-001) and add entries.

## Removed

None yet.
