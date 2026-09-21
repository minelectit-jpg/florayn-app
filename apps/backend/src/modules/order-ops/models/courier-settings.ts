import { model } from "@medusajs/framework/utils"

/**
 * Courier (Steadfast) configuration, a single row edited from the admin. The
 * API credentials live here rather than in a constant so they can be rotated
 * without a deploy; the admin screen accepts them and the GET endpoint returns
 * them masked, never the raw secret.
 */
const CourierSettings = model.define("courier_settings", {
  id: model.id({ prefix: "cour" }).primaryKey(),
  provider: model.text().default("steadfast"),
  /** Steadfast merchant Api-Key. */
  api_key: model.text().nullable(),
  /** Steadfast merchant Secret-Key. */
  secret_key: model.text().nullable(),
  /** API base; defaults to the live Packzy host, overridable without a deploy. */
  base_url: model.text().default("https://portal.packzy.com/api/v1"),
  /** When false, courier actions are disabled in the UI. */
  enabled: model.boolean().default(false),
  /** Steadfast delivery_type default: 0 = home delivery, 1 = point/hub. */
  default_delivery_type: model.number().default(0),
})

export default CourierSettings
