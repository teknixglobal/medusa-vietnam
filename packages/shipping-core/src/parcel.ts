import { CarrierError } from "./errors"
import type { CarrierCapabilities, ParcelSpec } from "./types"

/** The parts of a Medusa line item (with its variant) that matter for sizing. */
export type ParcelItem = {
  quantity: number | string | { toString(): string }
  weight?: number | null
  length?: number | null
  width?: number | null
  height?: number | null
}

export type ParcelOptions = {
  /** Unit of variant.weight in this store. Default "g". */
  weight_unit?: "g" | "kg"
  /** Unit of variant length/width/height. Default "cm". */
  dimension_unit?: "cm" | "mm"
  /** Used when a variant has no weight. Default 500 g. */
  default_item_weight_g?: number
  /** Box and filler added once per parcel. Default 0. */
  packaging_weight_g?: number
  /** Smallest side used when dimensions are missing or tiny. Default 10 cm. */
  min_side_cm?: number
}

function positive(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * One parcel for all items: weights add up, items are stacked (longest length,
 * widest width, heights summed). Good enough for quotes; carriers re-weigh at pickup.
 */
export function buildParcel(items: readonly ParcelItem[], options: ParcelOptions = {}): ParcelSpec {
  const weightFactor = options.weight_unit === "kg" ? 1000 : 1
  const sizeFactor = options.dimension_unit === "mm" ? 0.1 : 1
  const defaultWeight = options.default_item_weight_g ?? 500
  const minSide = options.min_side_cm ?? 10

  let weight = options.packaging_weight_g ?? 0
  let length = 0
  let width = 0
  let height = 0
  for (const item of items) {
    const quantity = Number(item.quantity?.toString() ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue
    }
    const w = positive(item.weight)
    weight += (w !== undefined ? w * weightFactor : defaultWeight) * quantity
    length = Math.max(length, (positive(item.length) ?? 0) * sizeFactor)
    width = Math.max(width, (positive(item.width) ?? 0) * sizeFactor)
    height += (positive(item.height) ?? 0) * sizeFactor * quantity
  }

  return {
    weight_g: Math.max(1, Math.ceil(weight)),
    length_cm: Math.max(minSide, Math.ceil(length)),
    width_cm: Math.max(minSide, Math.ceil(width)),
    height_cm: Math.max(minSide, Math.ceil(height)),
  }
}

/** Throws PARCEL_TOO_LARGE / COD_TOO_HIGH before calling the carrier. */
export function assertWithinCapabilities(
  carrier: string,
  capabilities: CarrierCapabilities,
  parcel: ParcelSpec,
  codAmount = 0
): void {
  if (parcel.weight_g > capabilities.max_weight_g) {
    throw new CarrierError(
      carrier,
      "PARCEL_TOO_LARGE",
      `weight ${parcel.weight_g} g > ${capabilities.max_weight_g} g`
    )
  }
  const side = Math.max(parcel.length_cm, parcel.width_cm, parcel.height_cm)
  if (side > capabilities.max_side_cm) {
    throw new CarrierError(carrier, "PARCEL_TOO_LARGE", `side ${side} cm > ${capabilities.max_side_cm} cm`)
  }
  if (codAmount > capabilities.cod_max) {
    throw new CarrierError(carrier, "COD_TOO_HIGH", `COD ${codAmount} > ${capabilities.cod_max}`)
  }
}
