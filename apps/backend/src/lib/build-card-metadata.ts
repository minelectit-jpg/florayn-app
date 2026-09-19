/**
 * Precompute a product's "card" read-model into product.metadata.card.
 *
 * WHY: the storefront's below-the-fold strips (More Designs / You'll Love / Pack /
 * Matching Set / Recommended) and the shop grid need, per product, a
 * device|caseType -> {variantId, price, image, inStock} map plus a from-price.
 * Building that at request time forces hydrating every variant (102 for a phone
 * design) with options + metadata.images + prices for ~24 collection products =
 * ~2.4s / 3MB per cold render. Precomputing it into metadata means the pool can
 * fetch handle+thumbnail+metadata only (no *variants) and read the maps directly.
 *
 * This is a PURE function over an already-fetched product + a stock lookup, so it
 * is reused by both the backfill (all products) and the change subscribers (one
 * product). It never calls the price engine: variant.prices already holds the BDT
 * amount, so no region is needed.
 */

export type CardVariant = {
  variantId: string
  price: number | null
  image: string | null
  inStock: boolean
}

export type ProductCard = {
  /** Cheapest in-stock (or any, if none in stock) priced variant, in minor units. */
  fromPrice: number | null
  /** Whether ANY variant of this product is in stock. */
  inStock: boolean
  /** Device option values that this product actually sells. */
  devices: string[]
  /** Case Type option values that this product actually sells. */
  caseTypes: string[]
  /** "deviceValue|caseTypeValue" -> variant facts. Keys match the storefront's. */
  pairs: Record<string, CardVariant>
  /** deviceValue -> first image seen for it (buy-box fallback when a pair is absent). */
  imageByDevice: Record<string, string>
  /** When this card was computed (ISO), for debugging drift. */
  builtAt: string
}

type MinimalOption = { id?: string; title?: string }
type MinimalVariantOption = { option_id?: string; value?: string }
type MinimalVariant = {
  id: string
  title?: string
  options?: MinimalVariantOption[] | null
  metadata?: Record<string, unknown> | null
  prices?: { amount?: number; currency_code?: string }[] | null
  /** Optional: some callers pass calculated_price instead of raw prices. */
  calculated_price?: { calculated_amount?: number } | null
}
type MinimalProduct = {
  options?: MinimalOption[] | null
  variants?: MinimalVariant[] | null
}

const lc = (s: unknown) => String(s ?? "").toLowerCase()

/** Price of one variant in minor units, preferring raw BDT price over calculated. */
function variantPrice(v: MinimalVariant): number | null {
  const raw = v.prices?.find((p) => lc(p.currency_code) === "bdt")?.amount
  if (typeof raw === "number") return raw
  const calc = v.calculated_price?.calculated_amount
  return typeof calc === "number" ? calc : null
}

/**
 * Build the card. `stockByVariantId` maps a variant id -> whether it is in stock;
 * pass an empty map to treat stock as unknown (inStock defaults true so a missing
 * inventory read never hides a product).
 */
export function buildCard(
  product: MinimalProduct,
  stockByVariantId: Map<string, boolean> = new Map()
): ProductCard {
  const optId = (title: string) =>
    product.options?.find((o) => lc(o.title) === title)?.id
  const deviceOptId = optId("device")
  const caseOptId = optId("case type")

  const pairs: Record<string, CardVariant> = {}
  const imageByDevice: Record<string, string> = {}
  const devices = new Set<string>()
  const caseTypes = new Set<string>()
  let fromPrice: number | null = null
  let anyInStock = false

  for (const v of product.variants ?? []) {
    const dev = deviceOptId
      ? v.options?.find((o) => o.option_id === deviceOptId)?.value
      : undefined
    const ct = caseOptId
      ? v.options?.find((o) => o.option_id === caseOptId)?.value
      : undefined
    const image =
      (v.metadata?.images as string[] | undefined)?.[0] ?? null
    const price = variantPrice(v)
    const inStock = stockByVariantId.size ? stockByVariantId.get(v.id) ?? false : true

    if (dev) {
      devices.add(dev)
      if (image && !imageByDevice[dev]) imageByDevice[dev] = image
    }
    if (ct) caseTypes.add(ct)

    if (dev && ct) {
      const key = `${dev}|${ct}`
      if (!pairs[key]) pairs[key] = { variantId: v.id, price, image, inStock }
    }

    if (inStock) anyInStock = true
    // Cheapest priced variant becomes the "from" price. Prefer in-stock, but fall
    // back to any priced variant so a fully out-of-stock design still shows a price.
    if (typeof price === "number" && price > 0) {
      if (fromPrice == null || price < fromPrice) fromPrice = price
    }
  }

  return {
    fromPrice,
    inStock: stockByVariantId.size ? anyInStock : true,
    devices: [...devices],
    caseTypes: [...caseTypes],
    pairs,
    imageByDevice,
    builtAt: new Date().toISOString(),
  }
}
