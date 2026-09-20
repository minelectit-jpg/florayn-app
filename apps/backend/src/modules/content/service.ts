import { MedusaService } from "@medusajs/framework/utils"

import CheckoutSetting from "./models/checkout-setting"
import CollectionPage from "./models/collection-page"
import FeatureBlock from "./models/feature-block"
import FeaturedPick from "./models/featured-pick"
import GalleryVideo from "./models/gallery-video"
import HomeSection from "./models/home-section"
import MenuItem from "./models/menu-item"
import MenuSection from "./models/menu-section"
import SeoOverride from "./models/seo-override"
import SeoSetting from "./models/seo-setting"

class ContentModuleService extends MedusaService({
  CheckoutSetting,
  HomeSection,
  MenuSection,
  MenuItem,
  CollectionPage,
  SeoSetting,
  SeoOverride,
  FeatureBlock,
  FeaturedPick,
  GalleryVideo,
}) {}

export default ContentModuleService
