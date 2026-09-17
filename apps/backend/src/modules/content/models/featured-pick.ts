import { model } from "@medusajs/framework/utils"

/**
 * One design the owner has hand-picked for the "We think you'll love" band on
 * the product page. `handle` is the phone-case product's handle; the storefront
 * resolves it to that design and renders it on the customer's currently
 * selected device, so a 16 Pro Max shopper sees the pick as a 16 Pro Max case.
 *
 * These are a small, ordered, global list — the same suggestions on every
 * product page — editable from the admin without a deploy.
 */
const FeaturedPick = model.define("featured_pick", {
  id: model.id({ prefix: "featpick" }).primaryKey(),
  /** The phone-case product handle this pick points at. */
  handle: model.text(),
  position: model.number().default(0),
  is_visible: model.boolean().default(true),
})

export default FeaturedPick
