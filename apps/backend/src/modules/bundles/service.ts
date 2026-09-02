import { MedusaService } from "@medusajs/framework/utils"

import BundleSettings from "./models/bundle-settings"
import BundleTier from "./models/bundle-tier"

class BundlesModuleService extends MedusaService({
  BundleSettings,
  BundleTier,
}) {}

export default BundlesModuleService
