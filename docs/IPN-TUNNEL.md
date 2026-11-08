# IPN / webhooks during development (Cloudflare Tunnel + Access)

Gateways call the backend from the internet, so the webhook URL must be public HTTPS. With the backend behind a Cloudflare Tunnel and Cloudflare Access, Access answers the gateway with a login redirect and the IPN never arrives. Open only the webhook path.

## 1. Public URL

The backend is already routed through the tunnel, e.g. `https://yaahsport-api-dev.yaah.me` -> `app:9000`.
Webhook URLs:

| Gateway | URL |
|---|---|
| SePay | `https://<backend-host>/hooks/payment/sepay_sepay` |
| (next) VNPay | `https://<backend-host>/hooks/vnpay/ipn` (GET, own route) |

## 2. Access bypass for `/hooks` only

Cloudflare Zero Trust > Access > Applications > Add an application > Self-hosted:

- Application domain: subdomain `<backend subdomain>`, domain `<zone>`, **path `hooks`** (covers `/hooks/*`, all gateways).
- Policy: action **Bypass**, include **Everyone**.

A path-scoped application is more specific than the wildcard app, so only `/hooks/*` skips login; Admin and the Store API stay protected.

Check from any machine (expect `200`, not a 302 to the Access login):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<backend-host>/hooks/payment/sepay_sepay -H "content-type: application/json" -d "{}"
```

## 3. SePay

my.sepay.vn > Payment Gateway (Sandbox) > Configuration > IPN:

- IPN URL: `https://<backend-host>/hooks/payment/sepay_sepay`
- Auth type: `SECRET_KEY` (optional). Copy the key into `SEPAY_IPN_SECRET_KEY` in the backend `.env` and restart. Without it the plugin still verifies every IPN through the order API.

## 4. Without a public URL

Everything still works when the customer comes back to the shop: completing the cart makes the provider ask the gateway API. IPN only matters when the customer closes the browser after paying. To test that path locally, send the IPN to `http://localhost:9000/hooks/payment/sepay_sepay` yourself (see ADDING-A-GATEWAY.md section 5).
