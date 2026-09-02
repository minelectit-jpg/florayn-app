import { MedusaService } from "@medusajs/framework/utils"

import HomeSection from "./models/home-section"
import MenuItem from "./models/menu-item"
import MenuSection from "./models/menu-section"

class ContentModuleService extends MedusaService({
  HomeSection,
  MenuSection,
  MenuItem,
}) {}

export default ContentModuleService
