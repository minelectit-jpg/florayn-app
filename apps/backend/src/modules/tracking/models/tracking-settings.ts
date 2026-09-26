import { model } from "@medusajs/framework/utils"

/**
 * Ad tracking settings, a single row with the fixed id "trackset_default"
 * (TRACKING.md 2.1). `config` holds every non-secret setting and is read
 * through parseTrackingConfig() in lib/tracking/settings.ts, which fills in
 * the defaults. The four access tokens are write-only: the admin GET returns
 * them masked, never raw. The feed token is shown in full because the owner
 * copies the feed URL. Every other tracking table is a raw table created by
 * the module's hand-written migration.
 */
const TrackingSettings = model.define("tracking_settings", {
  id: model.id({ prefix: "trackset" }).primaryKey(),
  config: model.json().default({}),
  /** Meta Conversions API token for the TEST dataset. */
  meta_test_token: model.text().nullable(),
  /** Meta Conversions API token for the live dataset. */
  meta_live_token: model.text().nullable(),
  /** TikTok Events API token for the TEST pixel. */
  tiktok_test_token: model.text().nullable(),
  /** TikTok Events API token for the live pixel. */
  tiktok_live_token: model.text().nullable(),
  /** 32 url-safe chars in the catalog feed URL, generated on first use. */
  catalog_feed_token: model.text().nullable(),
})

export default TrackingSettings
