import { unstable_cache } from "next/cache"

import { getRegionId, sdk, type StoreProduct, type StoreVariant } from "@/lib/medusa"

// Compatibility and filter choices need variant IDs/options, not prices and
// galleries for every device a product fits.
export const COLLECTION_FIELDS =
  "id,title,handle,subtitle,thumbnail,metadata,images.url," +
  "options.id,options.title,options.values.value," +
  "variants.id,variants.title,variants.options.option_id,variants.options.value"

const VARIANT_BATCH_SIZE = 100
const VARIANT_FIELDS =
  "id,title,metadata,calculated_price.calculated_amount,calculated_price.currency_code"
const QUERY_TIMEOUT_MS = 15_000
const LEGACY_COLLECTION_FIELDS =
  "id,title,handle,subtitle,thumbnail,metadata,images.url," +
  "options.id,options.title,options.values.value," +
  "variants.id,variants.title,variants.metadata," +
  "*variants.options,*variants.calculated_price"

function productTags(products: StoreProduct[]) {
  return ["products", ...new Set(products.map((product) => `product:${product.handle}`))]
}

async function getPricingRegion(): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      getRegionId(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The pricing region request timed out")), QUERY_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Match ProductCard's device scope, including its all-variant fallback. */
export function collectionVariantIds(
  products: StoreProduct[],
  device: string,
  includeFirstVariant = true
): string[] {
  const ids = new Set<string>()
  for (const product of products) {
    const variants = product.variants ?? []
    const matching = device
      ? variants.filter((variant) => variant.options?.some((option) => option.value === device))
      : variants
    for (const variant of matching.length ? matching : variants) ids.add(variant.id)
    // The two price sorts use the first variant even on a different device.
    // Other sorts only need the card's device scope (or all-variant fallback).
    if (includeFirstVariant && variants[0]) ids.add(variants[0].id)
  }
  return [...ids].sort()
}

async function loadVariantBatch(ids: string[], regionId: string): Promise<StoreVariant[]> {
  const result = await sdk.client.fetch<{ variants: StoreVariant[] }>("/store/product-variants", {
    query: { id: ids, region_id: regionId, limit: ids.length, fields: VARIANT_FIELDS },
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  })
  const byId = new Map((result.variants ?? []).map((variant) => [variant.id, variant]))
  // A transient empty/partial response must not become a successful cache entry.
  if (ids.some((id) => !byId.has(id))) {
    throw new Error("The collection variant response was incomplete")
  }
  return ids.map((id) => {
    const variant = byId.get(id)!
    return {
      id: variant.id,
      title: variant.title,
      metadata: { images: variant.metadata?.images ?? [] },
      calculated_price: variant.calculated_price
        ? {
            calculated_amount: variant.calculated_price.calculated_amount,
            currency_code: variant.calculated_price.currency_code,
          }
        : variant.calculated_price,
    }
  })
}

async function loadPricedFallback(products: StoreProduct[]): Promise<{ products: StoreProduct[] }> {
  const regionId = await getPricingRegion()
  if (!regionId) throw new Error("The collection pricing region is unavailable")
  const ids = products.map((product) => product.id).sort()
  const cached = unstable_cache(
    async () => {
      const result = await sdk.client.fetch<{ products: StoreProduct[] }>("/store/products", {
        query: { id: ids, region_id: regionId, limit: ids.length, fields: LEGACY_COLLECTION_FIELDS },
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      })
      const byId = new Map((result.products ?? []).map((product) => [product.id, product]))
      if (ids.some((id) => !byId.has(id))) {
        throw new Error("The collection product response was incomplete")
      }
      return ids.map((id) => byId.get(id)!)
    },
    ["collection-priced-fallback", "v1", regionId, ...ids],
    { revalidate: 3600, tags: productTags(products) }
  )
  const byId = new Map((await cached()).map((product) => [product.id, product]))
  return { products: products.map((product) => byId.get(product.id)!) }
}

/** Price only cards' visible device variants, using Medusa's real price engine. */
export async function hydrateCollectionProducts(
  products: StoreProduct[],
  device: string,
  { includeFirstVariant = true }: { includeFirstVariant?: boolean } = {}
): Promise<{ products: StoreProduct[] }> {
  const ids = collectionVariantIds(products, device, includeFirstVariant)
  if (!ids.length) return { products }
  try {
    const regionId = await getPricingRegion()
    if (!regionId) throw new Error("The pricing region is unavailable")
    const tags = productTags(products)
    const details = new Map<string, StoreVariant>()
    // Sequential batches cap backend pressure and keep request URLs bounded.
    for (let offset = 0; offset < ids.length; offset += VARIANT_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + VARIANT_BATCH_SIZE)
      const cached = unstable_cache(
        () => loadVariantBatch(batch, regionId),
        ["collection-variant-details", "v1", regionId, ...batch],
        { revalidate: 3600, tags }
      )
      for (const variant of await cached()) details.set(variant.id, variant)
    }
    return {
      products: products.map((product) => ({
        ...product,
        variants: (product.variants ?? []).map((variant) => {
          const detail = details.get(variant.id)
          return detail ? { ...variant, ...detail } : variant
        }),
      })),
    }
  } catch (error) {
    console.error("[collection] variant prices unavailable:", error instanceof Error ? error.message : String(error))
    // Fall back to the previous full region-priced query, never raw metadata or
    // flat case prices. Errors and incomplete responses throw before caching;
    // both paths failing must not produce a cacheable empty/error product grid.
    return loadPricedFallback(products)
  }
}
