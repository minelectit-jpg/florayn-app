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
  // Representative photo for the "Shop by style" menu card; admin-editable.
  image_url: model.text().nullable(),
  // Short code used when building variant SKUs, e.g. ARMBLK.
  sku_code: model.text(),
  // Flat price in BDT for every variant of every product in this case type.
  price: model.number(),
  // Optional per-device-group price overrides, admin-editable. Shape:
  // [{ label, price, devices: [deviceSlug] }]. A device in no group falls back
  // to the flat `price`. Only Alcantara uses these today (its shells cost
  // different amounts per body). Null means "no overrides"; the code then falls
  // back to the seed's price_groups so nothing is lost before the admin edits.
  price_groups: model.json().nullable(),
  sort_order: model.number().default(0),
  is_active: model.boolean().default(true),
  devices: model.manyToMany(() => Device, {
    mappedBy: "case_types",
    pivotTable: "case_type_devices",
  }),
})

export default CaseType
