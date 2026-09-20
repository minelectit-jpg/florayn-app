import { unstable_cache } from "next/cache"

import Medusa from "@medusajs/js-sdk"

export const MEDUSA_BACKEND_URL =
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"

export const MEDUSA_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

export const sdk = new Medusa({
  baseUrl: MEDUSA_BACKEND_URL,
  debug: process.env.NODE_ENV === "development",
  publishableKey: MEDUSA_PUBLISHABLE_KEY,
})

/**
 * Fields the storefront needs on a product. Kept in one place because the
 * product card and the product page must agree on what is loaded.
 */
export const PRODUCT_FIELDS =
  "id,title,handle,subtitle,description,thumbnail,metadata,created_at," +
  "*images,*options,*options.values,*variants,*variants.options," +
  "*variants.metadata," +
  "*variants.calculated_price,*collection,*categories"

/** Product-page selectors and galleries, including actual regional prices. */
export const PRODUCT_PAGE_FIELDS =
  "id,title,handle,subtitle,description,thumbnail,metadata,created_at," +
  "images.id,images.url,options.id,options.title,options.values.id,options.values.value," +
  "variants.id,variants.title,variants.metadata,variants.options.option_id,variants.options.value," +
  "variants.calculated_price.calculated_amount,variants.calculated_price.currency_code," +
  "collection.id,collection.title,collection.handle,categories.id,categories.name,categories.handle"

/**
 * The related-products POOL fields for the product page's below-the-fold strips
 * (More Designs / You'll Love / Pack / Matching Set / Recommended). NO *variants:
 * each pool product carries a precomputed metadata.card (device|caseType ->
 * {variantId, price, image}) written by /admin/rebuild-cards, and the page
 * rebuilds the tiny variant shape the strips iterate from that card
 * (hydratePoolVariantsFromCard) instead of hydrating ~102 real variants per
 * product. *options stays (the strips read the Case Type / Device option ids).
 * Measured: collection pool 2.4s/3.1MB (all variants) -> ~0.42s/360KB (card).
 */
export const POOL_FIELDS =
  "id,title,handle,subtitle,thumbnail,metadata,options.id,options.title"

/*
 * Everything a product CARD renders, and nothing it does not. The card shows a
 * thumbnail, a price range and a device-aware meta line, so it needs variant
 * titles and prices but not the 100+ gallery images or the per-variant image
 * arrays that a listing would otherwise pull for every card. Use this for any
 * grid or carousel of cards; PRODUCT_FIELDS is for the product page itself.
 */
export const CARD_FIELDS =
  "id,title,handle,thumbnail,metadata," +
  "variants.id,variants.title," +
  "variants.calculated_price.calculated_amount,variants.calculated_price.currency_code"

export type StoreProduct = {
  id: string
  title: string
  handle: string
  subtitle?: string | null
  description?: string | null
  thumbnail?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
  images?: { id: string; url: string }[]
  options?: { id: string; title: string; values?: { id: string; value: string }[] }[]
  variants?: StoreVariant[]
  collection?: { id: string; title: string; handle: string } | null
  categories?: { id: string; name: string; handle: string }[]
}

export type StoreVariant = {
  id: string
  title: string
  /** Carries this device's own gallery, written by wire-images-device.ts. */
  metadata?: Record<string, unknown> | null
  sku?: string | null
  options?: { id: string; option_id: string; value: string }[]
  calculated_price?: {
    calculated_amount: number
    currency_code: string
  } | null
  inventory_quantity?: number
  allow_backorder?: boolean
  manage_inventory?: boolean
}

let regionIdPromise: Promise<string | undefined> | undefined

/**
 * Prices are region-scoped, so every product query needs a region. There is one
 * region (Bangladesh), so it is resolved once and reused.
 */
export function getRegionId(): Promise<string | undefined> {
  if (!regionIdPromise) {
    regionIdPromise = sdk.store.region
      .list({ limit: 1 })
      .then(({ regions }) => regions?.[0]?.id)
      .catch(() => undefined)
      .then((id) => {
        // Never memoize a failure. A backend that is briefly unreachable while
        // the storefront boots would otherwise poison this cache for the
        // process lifetime, and every later product query would 400 with
        // "Missing required pricing context to calculate prices - region_id".
        if (!id) {
          regionIdPromise = undefined
        }
        return id
      })
  }
  return regionIdPromise
}

export type ProductListResult = {
  products: StoreProduct[]
  count: number
  /**
   * Set when the catalogue could not be READ - not when it is genuinely
   * empty. Callers must tell those apart: an empty grid is a truthful answer
   * to "no products match", and a lie when the backend was unreachable.
   */
  error?: string
}

export type ProductListOptions = {
  /** Medusa adds all variant prices when region_id is present, even if omitted from fields. */
  pricing?: boolean
}

/**
 * Why a failure is reported rather than swallowed.
 *
 * This used to return an empty list on any error, which turned an unreachable
 * backend into a page that said "0 products". A production storefront once
 * sat like that against a database holding 525 of them, and the empty grid
 * sent the search towards the data instead of the connection. Returning
 * `error` costs nothing and keeps that mistake from being silent.
 *
 * It still does not throw. A blip should degrade the page, not 500 the site.
 */
/*
 * @medusajs/js-sdk does NOT forward next/cache into fetch, so under Next 15 every
 * SDK product call is no-store and re-hits Medusa on every render - the measured
 * cause of 2-7s cold pages and the DB-pool jam under prefetch storms. We wrap the
 * result in unstable_cache so the product JSON lands in Next's FETCH/data cache,
 * which our Redis cacheHandler stores UN-namespaced -> it survives every deploy, so
 * a cold post-deploy render reads product data from Redis instead of stampeding
 * Medusa. Entries are tagged so an admin edit (see /api/revalidate) can bust them.
 */
const DATA_VERSION = "v1" // bump when PRODUCT_FIELDS / StoreProduct shape changes
const CACHE_TTL_SECONDS = 3600 // data freshness; admin edits bust it via revalidateTag
const MAX_CACHEABLE_LIMIT = 200 // don't cache huge listings (sitemap pulls 600)

/** Stable cache-key part from the query params (order-independent). */
function stableKey(params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

// Hard ceiling on any single product query. Normal queries are 0.3-1.7s (the
// 600-item sitemap query ~3-5s), but the build prerenders home/shop/collections/
// sitemap on the SAME 2-vCPU box as Medusa, so a prerender burst can transiently
// slow the backend; without a cap one hung query hits Next's 120s page timeout and
// FAILS THE WHOLE BUILD (repeatedly seen on /sitemap). Capping here turns a hang
// into a fast throw -> graceful empty result -> the page/sitemap builds with a
// fallback and regenerates at runtime (where the backend is fast). Also caps
// runtime cache-misses so a jammed backend degrades instead of hanging.
const QUERY_TIMEOUT_MS = 15_000

/**
 * The raw SDK call. THROWS on failure (or timeout) so a transient backend error
 * is never written to the cache (mirrors getRegionId's "never memoize a failure").
 */
async function listProductsUncached(
  params: Record<string, unknown>,
  pricing: boolean
): Promise<ProductListResult> {
  const call = (async () => {
    const { region_id: requestedRegion, ...query } = params
    const requestedFields = typeof query.fields === "string" ? query.fields : PRODUCT_FIELDS
    // Omitting only calculated_price fields is insufficient: Medusa 2.19 adds
    // them back when region_id is present. Explicit unpriced reads omit both.
    const fields = pricing
      ? requestedFields
      : requestedFields.split(",").filter((field) => !field.includes("calculated_price")).join(",")
    const result = await sdk.store.product.list({
      limit: 24,
      ...query,
      fields,
      ...(pricing ? { region_id: typeof requestedRegion === "string" ? requestedRegion : await getRegionId() } : {}),
    })
    return result as unknown as ProductListResult
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`medusa product list timed out after ${QUERY_TIMEOUT_MS}ms`)),
          QUERY_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function listProducts(
  params: Record<string, unknown> = {},
  options: ProductListOptions = {}
): Promise<ProductListResult> {
  const pricing = options.pricing !== false
  const limit = typeof params.limit === "number" ? params.limit : 24
  const handles =
    typeof params.handle === "string"
      ? [params.handle]
      : Array.isArray(params.handle)
        ? params.handle.filter((handle): handle is string => typeof handle === "string")
        : []
  try {
    // Very large listings bypass the cache (keeps multi-MB values out of Redis).
    if (limit > MAX_CACHEABLE_LIMIT) {
      return await listProductsUncached(params, pricing)
    }
    const tags = ["products"]
    for (const handle of new Set(handles)) tags.push(`product:${handle}`)
    const cached = unstable_cache(
      () => listProductsUncached(params, pricing),
      ["products", DATA_VERSION, pricing ? "priced" : "unpriced", stableKey(params)],
      { revalidate: CACHE_TTL_SECONDS, tags }
    )
    return await cached()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[medusa] product list failed against ${MEDUSA_BACKEND_URL}: ${detail}`)

    /*
     * NEXT_PUBLIC_* are compiled in, so a production build that fell back to
     * localhost cannot be repaired by setting a variable and restarting - it
     * needs rebuilding with the variable in scope. Name that here, because
     * the symptom looks nothing like the cause.
     */
    if (process.env.NODE_ENV === "production" && /localhost|127\.0\.0\.1/.test(MEDUSA_BACKEND_URL)) {
      console.error(
        `[medusa] the backend URL is ${MEDUSA_BACKEND_URL} in a production build. ` +
          `NEXT_PUBLIC_MEDUSA_BACKEND_URL was not set when this was BUILT - ` +
          `setting it now and restarting will not help, it has to be rebuilt.`
      )
    }
    if (!MEDUSA_PUBLISHABLE_KEY) {
      console.error("[medusa] NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY is empty in this build.")
    }

    return { products: [], count: 0, error: detail }
  }
}

/**
 * Set each variant's calculated_price from the fixed case-type price, keyed by
 * the case-type option value (a variant's option that is a case-type NAME, e.g.
 * "Signature"). Lets a product fetched without calculated_price feed the buy box
 * and case-type tiles unchanged. (Alcantara is priced per-device in the store;
 * here it takes the base case-type price - fine for the handful of Alcantara
 * designs, revisit if per-device Alcantara pricing must show exactly.)
 */
export function applyCaseTypePrices(
  product: StoreProduct | null | undefined,
  priceByCaseTypeName: Map<string, number>
): void {
  for (const v of product?.variants ?? []) {
    const ctVal = (v.options ?? [])
      .map((o) => o.value)
      .find((x) => priceByCaseTypeName.has(x))
    const price = ctVal != null ? priceByCaseTypeName.get(ctVal) : undefined
    if (typeof price === "number") {
      ;(v as unknown as { calculated_price?: unknown }).calculated_price = {
        calculated_amount: price,
      }
    }
  }
}

export async function getProductByHandle(handle: string) {
  const { products } = await listProducts({
    handle,
    limit: 1,
    fields: PRODUCT_PAGE_FIELDS,
  })
  return products?.[0]
}
