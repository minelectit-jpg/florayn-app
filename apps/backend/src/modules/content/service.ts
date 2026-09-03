import { MedusaService } from "@medusajs/framework/utils"

import CollectionPage from "./models/collection-page"
import HomeSection from "./models/home-section"
import MenuItem from "./models/menu-item"
import MenuSection from "./models/menu-section"
import SeoOverride from "./models/seo-override"
import SeoSetting from "./models/seo-setting"

class ContentModuleService extends MedusaService({
  HomeSection,
  MenuSection,
  MenuItem,
  CollectionPage,
  SeoSetting,
  SeoOverride,
}) {}

export default ContentModuleService
