// The Privacy page singleton, id `privacyset_default`. The defaults equal
// DEFAULT_PRIVACY_SETTINGS; they are literals here because privacy-settings.ts
// resolves this module, and importing it from a model would be a cycle.
import { model } from "@medusajs/framework/utils"

const PrivacySetting = model.define("privacy_setting", {
  id: model.id({ prefix: "privacyset" }).primaryKey(),
  title: model.text().default("Privacy policy"),
  body: model.text().default(""),
  published: model.boolean().default(false),
})

export default PrivacySetting
