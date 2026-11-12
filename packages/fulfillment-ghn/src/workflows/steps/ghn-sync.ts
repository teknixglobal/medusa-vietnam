import type { IFulfillmentModuleService, IOrderModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import type { ShipmentSnapshot } from "@teknixglobal/teknix-vietnam-shipping-core"
import { ghnRuntimeFrom } from "../../lib/config"

/** Ask GHN for the real status: webhook payloads are not signed, so they are never trusted. */
export const fetchGhnShipmentStep = createStep(
  "fetch-ghn-shipment",
  async (input: { order_code: string }, { container }) => {
    const runtime = ghnRuntimeFrom(container)
    if (!runtime) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "GHN provider is not configured")
    }
    const snapshot = await runtime.adapter.getShipment(input.order_code)
    return new StepResponse({ snapshot, provider_id: runtime.provider_id })
  }
)

export type GhnFulfillmentRef = {
  id: string
  order_id?: string
  data: Record<string, unknown>
  shipped_at?: Date | string | null
  delivered_at?: Date | string | null
  canceled_at?: Date | string | null
  items: { line_item_id: string; quantity: number }[]
}

/**
 * The fulfillment is found by GHN's client_order_code (our fulfillment id) and
 * must belong to the GHN provider and carry the same GHN order code.
 */
export const findGhnFulfillmentStep = createStep(
  "find-ghn-fulfillment",
  async (input: { snapshot: ShipmentSnapshot; provider_id: string }, { container }) => {
    const fulfillmentModule = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
    const id = input.snapshot.reference
    if (!id) {
      return new StepResponse(null as GhnFulfillmentRef | null)
    }
    const [f] = await fulfillmentModule.listFulfillments({ id }, { relations: ["items"] })
    const data = (f?.data ?? {}) as Record<string, unknown>
    if (!f || f.provider_id !== input.provider_id || data.ghn_order_code !== input.snapshot.carrier_order_code) {
      return new StepResponse(null as GhnFulfillmentRef | null)
    }
    const ref: GhnFulfillmentRef = {
      id: f.id,
      order_id: typeof data.order_id === "string" ? data.order_id : undefined,
      data,
      shipped_at: f.shipped_at,
      delivered_at: f.delivered_at,
      canceled_at: f.canceled_at,
      items: (f.items ?? [])
        .filter((i) => i.line_item_id)
        .map((i) => ({ line_item_id: String(i.line_item_id), quantity: Number(i.quantity) })),
    }
    return new StepResponse(ref)
  }
)

/** Writes the new GHN status into fulfillment.data; restores the previous data on rollback. */
export const updateGhnFulfillmentDataStep = createStep(
  "update-ghn-fulfillment-data",
  async (input: { id: string; data: Record<string, unknown>; previous: Record<string, unknown> }, { container }) => {
    const fulfillmentModule = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
    await fulfillmentModule.updateFulfillment(input.id, { data: input.data })
    return new StepResponse(input.data, { id: input.id, data: input.previous })
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }
    const fulfillmentModule = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
    await fulfillmentModule.updateFulfillment(previous.id, { data: previous.data })
  }
)

/** Merges one key into order.metadata; restores the previous metadata on rollback. */
export const setOrderMetadataStep = createStep(
  "set-vn-order-metadata",
  async (input: { order_id: string; key: string; value: unknown }, { container }) => {
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
    const order = await orderModule.retrieveOrder(input.order_id, { select: ["id", "metadata"] })
    const previous = (order.metadata ?? {}) as Record<string, unknown>
    await orderModule.updateOrders(input.order_id, { metadata: { ...previous, [input.key]: input.value } })
    return new StepResponse(input.value, { order_id: input.order_id, metadata: previous })
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
    await orderModule.updateOrders(previous.order_id, { metadata: previous.metadata })
  }
)
