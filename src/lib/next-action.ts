/**
 * What the storefront must do after the payment session is created.
 * Stored in `payment_session.data.next_action`. See CONTRACT.md.
 *
 * Form fields are an ordered list of [name, value] pairs: session data is
 * stored as Postgres jsonb, which does not keep object key order, and some
 * gateways check the field order of the posted form.
 */
export type NextAction =
  | { type: "form_post"; url: string; fields: [string, string][] }
  | { type: "redirect"; url: string }
  | {
      type: "qr"
      image_url: string
      content: string
      bank_account?: string
      amount: number
      expires_at?: string
    }
  | { type: "none" }
