import { model } from "@medusajs/framework/utils"

/**
 * A correction to the generated copy, for one design or one device.
 *
 * Device overrides win over design overrides, which win over the templates.
 * This is where a wrong claim about a cutout or a magnet gets fixed - the
 * generated fit copy is inferred from the hardware, not read from Florayn, so
 * it needs somewhere to be corrected without a deploy.
 */
const SeoOverride = model.define("seo_override", {
  id: model.id({ prefix: "seoovr" }).primaryKey(),
  /** "design" or "device". */
  scope: model.text(),
  /** The design slug or device slug this applies to. */
  key: model.text(),
  title: model.text().nullable(),
  description: model.text().nullable(),
  /** Replaces the generated fit sentence entirely. */
  fit_copy: model.text().nullable(),
  is_active: model.boolean().default(true),
})

export default SeoOverride
