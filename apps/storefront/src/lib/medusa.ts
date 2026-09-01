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

export async function listProducts(
  params: Record<string, unknown> = {}
): Promise<{ products: StoreProduct[]; count: number }> {
  try {
    const region_id = await getRegionId()
    const result = await sdk.store.product.list({
      fields: PRODUCT_FIELDS,
      region_id,
      limit: 24,
      ...params,
    })
    return result as unknown as { products: StoreProduct[]; count: number }
  } catch (error) {
    // A missing publishable key or an unreachable backend should render the
    // empty state with setup instructions, not a 500.
    console.error("[medusa] product list failed:", error)
    return { products: [], count: 0 }
  }
}

export async function getProductByHandle(handle: string) {
  const { products } = await listProducts({ handle, limit: 1 })
  return products?.[0]
}
