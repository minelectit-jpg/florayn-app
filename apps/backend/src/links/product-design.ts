import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"

import CatalogModule from "../modules/catalog"

/**
 * One design has many products - one per case type it is published in. This is
 * the link that lets a product page offer the same artwork in another finish.
 */
export default defineLink(
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  CatalogModule.linkable.design
)
