import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { computeReport, isReportRange, LiveInputError } from "../../../../lib/tracking/live"

/**
 * GET /admin/tracking/report?range=7d|30d&host= - the 7 and 30 day tabs of
 * Admin > Live (TRACKING.md 9, 4.6): a daily series, the funnel and the
 * dimension tables from tracking_day_dim and tracking_session, shared for
 * 5 minutes. Any other range is a 400; `host` works as on the live route.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const query = (req.query as Record<string, unknown> | undefined) ?? {}
  if (!isReportRange(query.range)) return res.status(400).json({ message: "range must be 7d or 30d." })
  try {
    return res.json(await computeReport(req.scope, query.range, { host: typeof query.host === "string" ? query.host : null }))
  } catch (error) {
    if (error instanceof LiveInputError) return res.status(400).json({ message: error.message })
    throw error
  }
}
