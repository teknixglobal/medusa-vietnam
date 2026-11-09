import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import GhnFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [GhnFulfillmentService],
})
