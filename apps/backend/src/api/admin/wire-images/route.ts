import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  imageWiringStatus,
  wireImagesDevice,
} from "../../../lib/wire-images-device"

/**
 * Wire R2 image URLs into the catalogue, run FROM THE ADMIN.
 *
 * This exists because the host has no SSH and does not inject dashboard
 * environment variables into a cron, so neither `medusa exec` nor the Node
 * one-shot could be made to run reliably. The web process, though, is already
 * connected to the correct database - it is serving the catalogue - so wiring
 * from inside it needs no connection string and cannot target the wrong one.
 *
 * Auth is Medusa's own admin session: everything under /admin requires a
 * logged-in admin, so only someone who can already edit the catalogue can
 * trigger this. It is idempotent - re-running replaces the same URLs - so a
 * repeat or a partial run is safe.
 *
 * GET  /admin/wire-images  -> how far wiring has got (counts, no writes)
 * POST /admin/wire-images  -> run it; body { limit?: number } for a test batch
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status = await imageWiringStatus(req.scope)
  res.json({ status })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { limit?: number }
  const limit = Number.isFinite(body.limit) ? Math.max(0, Math.floor(body.limit as number)) : 0

  const logger = req.scope.resolve("logger")

  try {
    const before = await imageWiringStatus(req.scope)
    const result = await wireImagesDevice({
      container: req.scope,
      limit,
      onProgress: (m) => logger.info(`[wire-images] ${m}`),
    })
    const after = await imageWiringStatus(req.scope)

    res.json({ ok: true, ran: { limit: limit || "all" }, result, before, after })
  } catch (error: any) {
    logger.error(`[wire-images] ${error?.message ?? error}`)
    res.status(500).json({ ok: false, message: error?.message ?? String(error) })
  }
}
