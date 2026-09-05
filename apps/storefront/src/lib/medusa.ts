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
  "id,title,handle,subtitle,description,thumbnail,metadata," +
  "*images,*options,*options.values,*variants,*variants.options," +
  "*variants.metadata," +
  "*variants.calculated_price,*collection,*categories"

export type StoreProduct = {
  id: string
  title: string
  handle: string
  subtitle?: string | null
  description?: string | null
  thumbnail?: string | null
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
export async function listProducts(
  params: Record<string, unknown> = {}
): Promise<ProductListResult> {
  try {
    const region_id = await getRegionId()
    const result = await sdk.store.product.list({
      fields: PRODUCT_FIELDS,
      region_id,
      limit: 24,
      ...params,
    })
    return result as unknown as ProductListResult
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

export async function getProductByHandle(handle: string) {
  const { products } = await listProducts({ handle, limit: 1 })
  return products?.[0]
}
