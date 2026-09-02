import { model } from "@medusajs/framework/utils"

/**
 * The landing page for one collection, served at /collection/<slug>/.
 *
 * The ten Elementor pages on the live site share a structure - a hero, then a
 * heading, a line of copy and a grid of design tiles - but not a design: their
 * headings run from 90px/600 right-aligned white to 136px/700 left-aligned
 * cream, with different button shapes and colours. So this is one template
 * with the per-collection content as data, rather than ten hand-built pages.
 */
const CollectionPage = model.define("collection_page", {
  id: model.id({ prefix: "colpage" }).primaryKey(),
  /** Matches the Medusa collection or category handle in the URL. */
  collection_slug: model.text().unique(),
  /** Blank falls back to the artwork of the first design in the grid. */
  hero_image_url: model.text().nullable(),
  hero_eyebrow: model.text().nullable(),
  hero_heading: model.text().nullable(),
  cta_label: model.text().nullable(),
  cta_href: model.text().nullable(),
  /** Heading and copy above the tile grid. */
  intro_heading: model.text().nullable(),
  intro_copy: model.text().nullable(),
  /**
   * Which designs appear, in order. Empty means every design in the
   * collection, in catalogue order.
   */
  design_slugs: model.json().nullable(),
  is_visible: model.boolean().default(true),
  position: model.number().default(0),
})

export default CollectionPage
