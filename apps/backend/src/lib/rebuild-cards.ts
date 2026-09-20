import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { buildCard } from "./build-card-metadata"

// PostgreSQL JSONB can return object keys in a different order. Compare values,
// retaining array order, so writing a card cannot trigger an endless update loop.
function comparable(value: any): any {
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparable(value[key])]))
  }
  return value
}

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
  if (opts.productIds && !opts.productIds.length) return 0
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)

  const filters: Record<string, unknown> = {}
  if (opts.productIds?.length) filters.id = [...new Set(opts.productIds)]
  else if (opts.slug) filters.metadata = { design_slug: opts.slug }

  const fields = [
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
  ]

  let done = 0
  const BATCH = 25
  for (let skip = 0; ; skip += BATCH) {
    const { data: products } = await query.graph({
      entity: "product",
      ...(Object.keys(filters).length ? { filters } : {}),
      fields,
      pagination: { take: BATCH, skip, order: { id: "ASC" } },
    })
    const updates = products.flatMap((p: any) => {
      const card = buildCard(p)
      const { builtAt: _oldTime, ...previous } = p.metadata?.card ?? {}
      const { builtAt: _newTime, ...next } = card
      if (JSON.stringify(comparable(previous)) === JSON.stringify(comparable(next))) return []
      return [{ id: p.id, metadata: { ...(p.metadata ?? {}), card } }]
    })
    if (updates.length) {
      await productModule.upsertProducts(updates)
      done += updates.length
    }
    if (products.length < BATCH) break
  }
  return done
}
