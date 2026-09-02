import { model } from "@medusajs/framework/utils"

/**
 * One row. The store-wide copy and thresholds for the multi-buy widget, kept
 * in the database rather than in code so they can be edited from the admin.
 */
const BundleSettings = model.define("bundle_settings", {
  id: model.id({ prefix: "bndlset" }).primaryKey(),
  /** Widget heading above the tier pills. */
  heading: model.text().default("GET MORE SAVE MORE"),
  /** Label on the buy-one pill. */
  single_label: model.text().default("STANDARD PRICE"),
  /** Order total in BDT at which delivery becomes free. 0 disables it. */
  free_shipping_threshold: model.number().default(3400),
  /** Which products the tiers apply to. "cases" is everything sold today. */
  scope: model.text().default("cases"),
  is_active: model.boolean().default(true),
})

export default BundleSettings
