import { model } from "@medusajs/framework/utils"

import Device from "./device"

/**
 * A case type is a construction/finish, e.g. Alcantara or Armor Black. A design
 * is sold once per case type, so case type is half of the product identity and
 * is never a variant.
 */
const CaseType = model.define("case_type", {
  id: model.id({ prefix: "casetype" }).primaryKey(),
  slug: model.text().unique(),
  name: model.text(),
  description: model.text().nullable(),
  // Short code used when building variant SKUs, e.g. ARMBLK.
  sku_code: model.text(),
  // Floor price in BDT before the per-device delta is applied.
  base_price: model.number(),
  sort_order: model.number().default(0),
  is_active: model.boolean().default(true),
  devices: model.manyToMany(() => Device, {
    mappedBy: "case_types",
    pivotTable: "case_type_devices",
  }),
})

export default CaseType
