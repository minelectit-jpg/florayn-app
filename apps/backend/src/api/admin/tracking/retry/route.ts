import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { parseRetryBody, retryRows, scheduleFlush } from "../../../../lib/tracking/outbox"

/**
 * POST /admin/tracking/retry - Tracking > Health "Retry blocked/failed" and
 * "Send skipped from the last 6 days" (TRACKING.md 4.6, I3). Body
 * `{ platform?, env?, statuses }`; rows from the last 6 days go back to the
 * queue and a flush is scheduled. Request bodies are never logged.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const parsed = parseRetryBody(req.body)
  if (!parsed.ok) return res.status(400).json({ message: parsed.error })
  const queued = await retryRows(req.scope, parsed.request)
  if (queued) scheduleFlush(req.scope)
  return res.json({ queued })
}
