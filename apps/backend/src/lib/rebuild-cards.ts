import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { buildCard } from "./build-card-metadata"

/**
 * (Re)compute metadata.card for products and write it back. Shared by the
 * /admin/rebuild-cards backfill and the reprice / new-design freshness hooks, so
 * the precomputed card the storefront strips read never drifts from the real
 * variants. Additive: only metadata.card is (re)written, merged over existing
 * metadata.
 *
 * Pass nothing to rebuild every product, { slug } for one design, or
 * { productIds } for specific products (the freshness hooks use this).
 */
export async function rebuildCards(
  container: any,
  opts: { slug?: string; productIds?: string[] } = {}
): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)

  const filters: Record<string, unknown> = {}
  if (opts.productIds?.length) filters.id = opts.productIds
  else if (opts.slug) filters.metadata = { design_slug: opts.slug }

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

  const updates = products.map((p: any) => ({
    id: p.id,
    metadata: { ...(p.metadata ?? {}), card: buildCard(p) },
  }))

  let done = 0
  const BATCH = 50
  for (let i = 0; i < updates.length; i += BATCH) {
    await productModule.upsertProducts(updates.slice(i, i + BATCH))
    done += Math.min(BATCH, updates.length - i)
  }
  return done
}
