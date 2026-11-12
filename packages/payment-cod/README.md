# @teknixglobal/teknix-vietnam-payment-cod-medusa-plugin

Cash on delivery for Medusa v2 (VND). The order is placed with an authorized payment; capture it in Admin when the courier has collected the cash. Option `max_amount` refuses COD above a VND amount.

```ts
{ resolve: "@teknixglobal/teknix-vietnam-payment-cod-medusa-plugin", id: "cod", options: { max_amount: 5000000 } } // -> pp_cod_cod
```

Docs: [CONTRACT.md](https://github.com/teknixglobal/teknix-vietnam-commerce-plugins/blob/main/CONTRACT.md).
