# @teknixglobal/medusa-payment-cod

Cash on delivery for Medusa v2 (VND). The order is placed with an authorized payment; capture it in Admin when the courier has collected the cash. Option `max_amount` refuses COD above a VND amount.

```ts
{ resolve: "@teknixglobal/medusa-payment-cod", id: "cod", options: { max_amount: 5000000 } } // -> pp_cod_cod
```

Docs: [CONTRACT.md](https://github.com/teknixglobal/medusa-vietnam/blob/main/CONTRACT.md).
