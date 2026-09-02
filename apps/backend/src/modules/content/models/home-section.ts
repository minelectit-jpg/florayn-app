import { model } from "@medusajs/framework/utils"

/**
 * One band on the home page. Order and visibility are data, so the shop owner
 * can reorder or hide a section from the admin without a deploy.
 *
 * `type` decides which component renders it; `config` carries whatever that
 * component needs (tiles, slides, a product query) as JSON.
 */
const HomeSection = model.define("home_section", {
  id: model.id({ prefix: "homesec" }).primaryKey(),
  /** Stable handle, used in logs and to find a section again. */
  key: model.text().unique(),
  /**
   * category_pills | hero | marquee | tile_grid | product_carousel |
   * cta | testimonials
   */
  type: model.text(),
  title: model.text().nullable(),
  subtitle: model.text().nullable(),
  eyebrow: model.text().nullable(),
  cta_label: model.text().nullable(),
  cta_href: model.text().nullable(),
  /** Section-specific payload: tiles, slides, quotes. */
  config: model.json().nullable(),
  position: model.number().default(0),
  is_visible: model.boolean().default(true),
})

export default HomeSection
