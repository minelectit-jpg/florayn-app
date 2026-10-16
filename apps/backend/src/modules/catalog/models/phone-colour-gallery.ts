import { model } from "@medusajs/framework/utils"

/**
 * One phone colour's pictures for one variant (case type x device). Display
 * only (PHONE_COLOURS.md): the colour never becomes an option, variant, SKU,
 * price, stock key or cart-line field.
 *
 * `variant.metadata.images` stays the variant's main gallery. The row with
 * `is_main` records which colour that gallery shows and carries no images; the
 * other rows hold the extra colours' galleries. No module link, like
 * gallery_video: every store read intersects rows with the product's live,
 * published variants, so rows left by a deleted variant are inert.
 */
const PhoneColourGallery = model.define("phone_colour_gallery", {
  id: model.id({ prefix: "pcgal" }).primaryKey(),
  product_id: model.text(),
  variant_id: model.text(),
  // Copied from variant.metadata.device_slug / case_type_slug when saved.
  device_slug: model.text(),
  case_type_slug: model.text(),
  // colourSlug(<Mockup set colour>), e.g. "deep-blue".
  colour_slug: model.text(),
  // true: this colour is what variant.metadata.images shows.
  is_main: model.boolean().default(false),
  // null on the main row; 1-30 https URLs otherwise.
  images: model.array().nullable(),
  source: model.enum(["mockup_studio", "manual"]).default("manual"),
}).indexes([
  { on: ["variant_id", "colour_slug"], unique: true },
  // At most one main row per variant (the workflow keeps it so; this guards it).
  { name: "IDX_phone_colour_gallery_one_main", on: ["variant_id"], unique: true, where: "is_main = true" },
  { on: ["product_id"] },
  { on: ["device_slug", "case_type_slug", "colour_slug"] },
])

export default PhoneColourGallery
