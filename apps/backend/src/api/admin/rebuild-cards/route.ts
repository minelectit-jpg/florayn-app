import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { buildCard } from "../../../lib/build-card-metadata"

/**
 * POST /admin/rebuild-cards - (re)compute the precomputed card read-model
 * (metadata.card) for every product, or one { slug }.
 *
 * This is the backfill behind the storefront's variant-free listings/strips. It
 * reads each product's variants (options + metadata.images + prices) once via
 * query.graph and writes the compact card map back into product.metadata, so the
 * storefront never hydrates variants for a grid or a related-products strip.
 *
 * Stock is left at its default (in stock) here; the change subscribers own live
 * in_stock so a one-shot backfill never has to sweep inventory for 374 products.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = req.scope.resolve(Modules.PRODUCT)
  const logger = req.scope.resolve("logger")
  const body = (req.body ?? {}) as { slug?: string }

  try {
    const filters: Record<string, unknown> = {}
    if (body.slug) filters.metadata = { design_slug: body.slug }

    const { data: products } = await query.graph({
      entity: "product",
      ...(Object.keys(filters).length ? { filters } : {}),
      fields: [
        "id",
        "metadata",
        "options.id",
        "options.title",
        "variants.id",
        "variants.title",
        "variants.metadata",
        "variants.options.option_id",
        "variants.options.value",
        "variants.prices.amount",
        "variants.prices.currency_code",
      ],
    })

    const updates = products.map((p: any) => {
      const card = buildCard(p)
      return {
        id: p.id,
        metadata: { ...(p.metadata ?? {}), card },
      }
    })

    // Update in batches so one giant transaction never stalls the shared box.
    // upsertProducts treats each item with an id as an update (metadata merged
    // above), and takes the whole array in one call unlike updateProducts.
    let done = 0
    const BATCH = 50
    for (let i = 0; i < updates.length; i += BATCH) {
      await productModule.upsertProducts(updates.slice(i, i + BATCH))
      done += Math.min(BATCH, updates.length - i)
    }

    logger.info(`[rebuild-cards] wrote card metadata for ${done} products`)
    res.json({
      ok: true,
      products: done,
      sample: updates[0]
        ? { id: updates[0].id, card: (updates[0].metadata as any).card }
        : null,
    })
  } catch (error: any) {
    logger.error(`[rebuild-cards] ${error?.message ?? error}`)
    res.status(500).json({ ok: false, message: error?.message ?? String(error) })
  }
}
