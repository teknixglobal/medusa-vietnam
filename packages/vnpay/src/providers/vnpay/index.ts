import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import VnpayProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [VnpayProviderService],
})
