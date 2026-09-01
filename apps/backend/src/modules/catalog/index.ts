import { Module } from "@medusajs/framework/utils"

import CatalogModuleService from "./service"

export const CATALOG_MODULE = "catalog"

export default Module(CATALOG_MODULE, {
  service: CatalogModuleService,
})
