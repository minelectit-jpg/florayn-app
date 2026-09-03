import { model } from "@medusajs/framework/utils"

/**
 * One row: the templates every product page falls back to.
 *
 * Placeholders are {design}, {device}, {caseType}. A device page fills all
 * three; the base product page leaves {device} empty and the renderer tidies
 * the spacing.
 */
const SeoSetting = model.define("seo_setting", {
  id: model.id({ prefix: "seoset" }).primaryKey(),
  title_template: model
    .text()
    .default("{design} {device} Case - {caseType}"),
  description_template: model
    .text()
    .default(
      "{design} {device} case in our {caseType} finish. Printed in Dhaka, cash on delivery across Bangladesh."
    ),
  heading_template: model.text().default("{design} {device} Case"),
  /** Whether the generated fit sentence is shown at all. */
  fit_copy_enabled: model.boolean().default(true),
})

export default SeoSetting
