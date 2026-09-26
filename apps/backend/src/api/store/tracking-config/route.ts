import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { loadTrackingSettings, publicConfig } from "../../../lib/tracking/settings"

/**
 * GET /store/tracking-config - the ids and loading modes the storefront needs
 * to decide cookies and pixels (TRACKING.md 4.5). Never tokens, the alert
 * email, catalog settings or the feed token. On a database error the
 * storefront falls back to its all-off defaults, so nothing is cached then.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { config } = await loadTrackingSettings(req.scope)
    res.setHeader("Cache-Control", "public, max-age=60")
    return res.json({ config: publicConfig(config) })
  } catch {
    res.setHeader("Cache-Control", "no-store")
    return res.status(503).json({ message: "Tracking settings are unavailable." })
  }
}
