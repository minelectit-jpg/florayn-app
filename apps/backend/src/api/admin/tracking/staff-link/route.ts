import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { staffLinks } from "../../../../lib/tracking/live"
import { staffLinkToken } from "../../../../lib/tracking/secret"
import { loadTrackingSettings } from "../../../../lib/tracking/settings"

/**
 * GET /admin/tracking/staff-link - the "Exclude this browser" links of
 * Admin > Live (TRACKING.md 4.2, 4.6, owner decision 6): one
 * `https://<host>/api/t/staff/?t=<HMAC(secret, "staff-link-v1")>&on=1` per
 * test and live host (plus the `on=0` link that undoes it). Opening one on a
 * staff phone marks that browser: no pixels, nothing sent to ad platforms,
 * its visits and orders counted as internal. 409 while
 * TRACKING_INGEST_SECRET is unset, since the shop could not check the link.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const token = staffLinkToken()
  if (!token) {
    return res.status(409).json({
      message: "TRACKING_INGEST_SECRET is not set on the server, so staff links cannot be made yet.",
    })
  }
  const { config } = await loadTrackingSettings(req.scope)
  return res.json({ links: staffLinks(config, token) })
}
