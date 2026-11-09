import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import type { PaymentSessionStatus, UpdatePaymentInput, UpdatePaymentOutput } from "@medusajs/framework/types"

/** Payment session data as Medusa stores it (`payment_session.data`). */
export type PaymentSessionData = Record<string, unknown>

/** What a provider changes on update: `data` is a patch merged over the session data, never the whole data. */
export type PaymentSessionDataUpdate = {
  data?: PaymentSessionData
  status?: PaymentSessionStatus
}

/** Update input after the base class split off transient keys: `data` is always an object. */
export type SessionUpdateInput = Omit<UpdatePaymentInput, "data"> & { data: PaymentSessionData }

/**
 * Split session data into what stays stored and transient keys (inputs handed in through
 * updatePaymentSession, e.g. a raw gateway callback) that must never be stored.
 */
export function splitSessionData(
  data: PaymentSessionData | undefined,
  transientKeys: readonly string[] = []
): { stored: PaymentSessionData; transient: PaymentSessionData } {
  const stored: PaymentSessionData = { ...(data ?? {}) }
  const transient: PaymentSessionData = {}
  for (const key of transientKeys) {
    if (key in stored) {
      transient[key] = stored[key]
      delete stored[key]
    }
  }
  return { stored, transient }
}

/**
 * F-001 (FIXES.md): Medusa writes the `data` returned by `updatePayment` as the WHOLE
 * session data. Returning `{}` or a partial object wipes what initiatePayment stored.
 * Merge the patch over the stored data so nothing is lost.
 */
export function keepSessionData(
  stored: PaymentSessionData,
  update: PaymentSessionDataUpdate | void
): UpdatePaymentOutput {
  const output: UpdatePaymentOutput = { data: { ...stored, ...(update?.data ?? {}) } }
  if (update?.status) {
    output.status = update.status
  }
  return output
}

/**
 * Base class for Teknix payment providers. It owns `updatePayment` so every provider gets
 * the Medusa fixes listed in FIXES.md (F-001); providers implement `updateSessionData`
 * and must not override `updatePayment`.
 *
 * Only official extension points: this is a plain subclass of Medusa's AbstractPaymentProvider.
 */
export abstract class TeknixPaymentProviderBase<TOptions = Record<string, unknown>> extends AbstractPaymentProvider<TOptions> {
  /** Keys in the incoming session data that are inputs only and are dropped before storing. */
  protected readonly transientDataKeys: readonly string[] = []

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const { stored, transient } = splitSessionData(input.data, this.transientDataKeys)
    const update = await this.updateSessionData({ ...input, data: stored }, transient)
    return keepSessionData(stored, update)
  }

  /**
   * Return only what changes. Return nothing (or `{}`) to keep the session data as is.
   * `input.data` is the stored data without transient keys; `transient` holds those keys.
   */
  protected abstract updateSessionData(
    input: SessionUpdateInput,
    transient: PaymentSessionData
  ): Promise<PaymentSessionDataUpdate | void> | PaymentSessionDataUpdate | void
}
