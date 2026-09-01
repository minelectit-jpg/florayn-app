import { model } from "@medusajs/framework/utils"

/**
 * A design is the artwork. It is not sellable on its own: it becomes one
 * product per case type it is offered in. Grouping products under a design is
 * what lets a product page offer the same artwork in another finish.
 */
const Design = model.define("design", {
  id: model.id({ prefix: "design" }).primaryKey(),
  slug: model.text().unique(),
  name: model.text(),
  description: model.text().nullable(),
  theme: model.text().nullable(),
  artist: model.text().nullable(),
  hero_image_url: model.text().nullable(),
  // Short code used when building variant SKUs, e.g. CATMAZE.
  sku_code: model.text(),
  sort_order: model.number().default(0),
  is_active: model.boolean().default(true),
})

export default Design
