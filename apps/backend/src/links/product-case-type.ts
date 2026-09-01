import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"

import CatalogModule from "../modules/catalog"

/**
 * One case type has many products - one per design published in it.
 */
export default defineLink(
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  CatalogModule.linkable.caseType
)
