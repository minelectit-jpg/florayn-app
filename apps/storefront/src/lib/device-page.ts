import { getDeviceCatalog, type DeviceRecord } from "@/lib/catalog"
import { getProductByHandle, type StoreProduct } from "@/lib/medusa"

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
 * The base handle is tried first, so a design whose slug happens to end in
 * something device-shaped still resolves to itself.
 */
export type ResolvedProductPage = {
  product: StoreProduct
  /** The device this URL is for, or null on the base page. */
  device: DeviceRecord | null
  /** The handle of the underlying product, without the device suffix. */
  baseHandle: string
}

export async function resolveProductPage(
  slug: string
): Promise<ResolvedProductPage | null> {
  const direct = await getProductByHandle(slug)
  if (direct) {
    return { product: direct, device: null, baseHandle: direct.handle }
  }

  // Longest device slug first, so iphone-15-pro-max wins over iphone-15.
  const devices = [...(await getDeviceCatalog())].sort(
    (a, b) => b.slug.length - a.slug.length
  )
  const device = devices.find((d) => slug.endsWith(`-${d.slug}`))
  if (!device) return null

  const baseHandle = slug.slice(0, -(device.slug.length + 1))
  const product = await getProductByHandle(baseHandle)
  if (!product) return null

  // The device page only exists if the product is actually sold for it.
  const fits = (product.variants ?? []).some((v) => v.title === device.name)
  if (!fits) return null

  return { product, device, baseHandle }
}

/** The URL for one device of one product. */
export function devicePageHref(baseHandle: string, deviceSlug: string): string {
  return `/product/${baseHandle}-${deviceSlug}/`
}
