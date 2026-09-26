import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { sendTestAlert } from "../../../../lib/tracking/alerts"

/**
 * POST /admin/tracking/test-alert - "Send test alert" on Tracking and
 * Tracking > Health (TRACKING.md 4.6): one email to the alert address.
 * Answers `{ ok, error? }`; a missing email setup is an answer, not a crash.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  try {
    return res.json(await sendTestAlert(req.scope))
  } catch {
    return res.status(500).json({ ok: false, error: "The test alert could not be sent." })
  }
}
