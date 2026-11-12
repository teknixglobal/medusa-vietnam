import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import CodProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [CodProviderService],
})
