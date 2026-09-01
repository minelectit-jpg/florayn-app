import { MedusaService } from "@medusajs/framework/utils"

import CaseType from "./models/case-type"
import Design from "./models/design"
import Device from "./models/device"

class CatalogModuleService extends MedusaService({
  Design,
  CaseType,
  Device,
}) {}

export default CatalogModuleService
