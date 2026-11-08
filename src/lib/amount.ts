import { BigNumber, MedusaError } from "@medusajs/framework/utils"
import type { BigNumberInput } from "@medusajs/framework/types"

/**
 * VND has no minor unit: Medusa stores 250000 for 250.000 d.
 * Gateways expect a positive whole number of dong.
 */
export function toVndInteger(amount: BigNumberInput): number {
  const value = new BigNumber(amount).numeric
  if (!Number.isFinite(value)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid amount")
  }
  const rounded = Math.round(value)
  if (Math.abs(rounded - value) > 1e-6) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `VND amount must be a whole number, got ${value}`
    )
  }
  if (rounded <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Amount must be greater than 0"
    )
  }
  return rounded
}

export function assertVnd(currencyCode: string | undefined): void {
  if ((currencyCode ?? "").toLowerCase() !== "vnd") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Only VND is supported, got "${currencyCode}"`
    )
  }
}
