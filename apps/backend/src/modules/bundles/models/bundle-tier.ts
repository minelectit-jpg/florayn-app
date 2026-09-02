import { model } from "@medusajs/framework/utils"

/**
 * One multi-buy step: buy `quantity`, take `discount_amount` off the total.
 *
 * The flat amount is clamped to a percentage band of the subtotal, so a tier
 * stays sensible across case types that are priced very differently - 300৳ off
 * two 1,400৳ cases is a fair discount, 300৳ off two 3,800৳ Alcantara shells is
 * not. See `tierPricing` for the arithmetic.
 */
const BundleTier = model.define("bundle_tier", {
  id: model.id({ prefix: "bndltier" }).primaryKey(),
  /** How many of the item the customer takes. */
  quantity: model.number(),
  /** Ribbon on the pill, e.g. MOST POPULAR. Blank for none. */
  badge: model.text().nullable(),
  /** Flat BDT off the subtotal, before clamping. */
  discount_amount: model.number(),
  /** Discount floor as a percentage of subtotal. */
  min_pct: model.number().default(0),
  /** Discount ceiling as a percentage of subtotal. 0 means no ceiling. */
  max_pct: model.number().default(0),
  is_enabled: model.boolean().default(true),
  sort_order: model.number().default(0),
})

export default BundleTier
