import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { sendTestEvent } from "../../../../lib/tracking/outbox"

/**
 * POST /admin/tracking/test-event - "Send test event" on Tracking > Health
 * (TRACKING.md 4.6, I21). Body `{ platform: "meta" | "tiktok" }`. Sends one
 * event to the TEST destination only, right now: Meta a PageView (with the
 * test event code when set), TikTok a ViewContent. 409 when that platform has
 * no TEST destination or TEST token. Answers the result class, the vendor's
 * message and its trace id; never the token.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const platform = (req.body as { platform?: unknown } | undefined)?.platform
  if (platform !== "meta" && platform !== "tiktok") {
    return res.status(400).json({ message: "Choose meta or tiktok." })
  }
  const userAgent = req.headers["user-agent"]
  const result = await sendTestEvent(req.scope, platform, { userAgent: typeof userAgent === "string" ? userAgent : null })
  if (!result.ok) return res.status(409).json({ message: result.message })
  return res.json({ cls: result.cls, message: result.message, traceId: result.traceId, test_event_code: result.test_event_code })
}
