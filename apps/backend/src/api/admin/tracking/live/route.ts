import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { kickStaleJobs } from "../../../../lib/tracking/jobs"
import { computeLive, LiveInputError } from "../../../../lib/tracking/live"

/**
 * GET /admin/tracking/live?host= - Admin > Live (TRACKING.md 9, 4.6). One
 * result per host filter is shared for 10 s, however many tabs poll. `host`
 * is empty (all hosts before live sending is armed, the live hosts after),
 * `all`, `test`, `live` or one listed host; anything else is a 400. Opening
 * the page also restarts stale tracking jobs (6.4).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  kickStaleJobs(req.scope)
  const host = (req.query as Record<string, unknown> | undefined)?.host
  try {
    return res.json(await computeLive(req.scope, { host: typeof host === "string" ? host : null }))
  } catch (error) {
    if (error instanceof LiveInputError) return res.status(400).json({ message: error.message })
    throw error
  }
}
