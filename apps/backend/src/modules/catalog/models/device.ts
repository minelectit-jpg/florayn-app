import { model } from "@medusajs/framework/utils"

import CaseType from "./case-type"

/**
 * A device is a physical thing a case is made to fit. Devices become the
 * variants of every product, so this table is the single source of truth for
 * the variant axis of the whole catalog.
 */
const Device = model.define("device", {
  id: model.id({ prefix: "dev" }).primaryKey(),
  slug: model.text().unique(),
  name: model.text(),
  // Broad grouping used for case-type compatibility and storefront filtering.
  family: model.enum(["iphone", "samsung", "airpods", "watch", "wallet"]),
  brand: model.text(),
  // Short code used when building variant SKUs, e.g. IP17PM.
  sku_code: model.text(),
  // Added to the case type's base price to get the variant price, in BDT.
  price_delta: model.number().default(0),
  sort_order: model.number().default(0),
  is_active: model.boolean().default(true),
  case_types: model.manyToMany(() => CaseType, {
    mappedBy: "devices",
  }),
})

export default Device
