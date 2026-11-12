# @teknixglobal/teknix-vietnam-commerce-medusa-plugin

Optional Medusa v2 plugin: `GET /store/vietnam-payments/methods?region_id=...&locale=vi|en` returns the Vietnamese payment providers enabled for a region, with vi/en labels and the storefront flow (`form_post`, `redirect`, `qr`, `offline`).

```ts
plugins: [{ resolve: "@teknixglobal/teknix-vietnam-commerce-medusa-plugin", options: {} }]
```
