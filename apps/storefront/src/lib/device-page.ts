import { cache } from "react"

import { getDeviceCatalog, type DeviceRecord } from "@/lib/catalog"
import { listProducts, PRODUCT_FIELDS_NOPRICE, type StoreProduct } from "@/lib/medusa"

/**
 * /product/<slug>/ serves two kinds of page.
 *
 *   amber-leopard-signature              the product, default device
 *   amber-leopard-signature-iphone-12    the same product, iPhone 12 selected
 *
 * The second exists so every design x case type x device has an indexable URL
 * of its own, matching the shape the live catalogue has - without giving up
 * one product per design and case type in the admin.
 *
 * An exact product handle always takes precedence, so a design whose slug
 * happens to end in something device-shaped still resolves to itself.
 */
export type ResolvedProductPage = {
  product: StoreProduct
  /** The device this URL is for, or null on the base page. */
  device: DeviceRecord | null
  /** The handle of the underlying product, without the device suffix. */
  baseHandle: string
}

const resolveProductPageCached = cache(async (
  slug: string
): Promise<ResolvedProductPage | null> => {
  // Longest device slug first, so iphone-15-pro-max wins over iphone-15.
  const devices = [...(await getDeviceCatalog())].sort(
    (a, b) => b.slug.length - a.slug.length
  )
  const device = devices.find((d) => slug.endsWith(`-${d.slug}`))
  const baseHandle = device ? slug.slice(0, -(device.slug.length + 1)) : slug

  // Resolve both possibilities in one query instead of waiting for the exact
  // handle to miss before fetching the base product. With no device catalogue,
  // ordinary product handles can still resolve through the same lookup.
  const { products } = await listProducts({
    handle: device ? [slug, baseHandle] : slug,
    limit: device ? 2 : 1,
    fields: PRODUCT_FIELDS_NOPRICE,
  })
  const direct = products.find((product) => product.handle === slug)
  if (direct) {
    return { product: direct, device: null, baseHandle: direct.handle }
  }
  if (!device) return null

  const product = products.find((candidate) => candidate.handle === baseHandle)
  if (!product) return null

  // The device page only exists if the product is actually sold for it. A
  // variant's title is now "<Case Type> / <Device>", so match the Device option
  // value (device names never collide with case type names).
  const fits = (product.variants ?? []).some((v) =>
    (v.options ?? []).some((o) => o.value === device.name)
  )
  if (!fits) return null

  return { product, device, baseHandle }
})

export async function resolveProductPage(
  slug: string
): Promise<ResolvedProductPage | null> {
  // Metadata and the page share the lookup within a render. Give each caller
  // its own product because the page applies display prices to its variants.
  const resolved = await resolveProductPageCached(slug)
  return resolved
    ? { ...resolved, product: structuredClone(resolved.product) }
    : null
}

/** The URL for one device of one product. */
export function devicePageHref(baseHandle: string, deviceSlug: string): string {
  return `/product/${baseHandle}-${deviceSlug}/`
}
