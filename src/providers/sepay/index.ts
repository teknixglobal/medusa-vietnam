import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import SepayProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [SepayProviderService],
})
