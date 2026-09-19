import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { rebuildCards } from "../../../lib/rebuild-cards"

/**
 * POST /admin/rebuild-cards - (re)compute the precomputed card read-model
 * (metadata.card) for every product, or one { slug }. This is the backfill behind
 * the storefront's variant-free listings/strips; the reprice + new-design flows
 * keep it fresh from then on. See lib/rebuild-cards.ts.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve("logger")
  const body = (req.body ?? {}) as { slug?: string }
  try {
    const products = await rebuildCards(req.scope, { slug: body.slug })
    logger.info(`[rebuild-cards] wrote card metadata for ${products} products`)
    res.json({ ok: true, products })
  } catch (error: any) {
    logger.error(`[rebuild-cards] ${error?.message ?? error}`)
    res.status(500).json({ ok: false, message: error?.message ?? String(error) })
  }
}
