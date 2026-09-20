import { cache } from "react"

import { getDeviceCatalog, type DeviceRecord } from "@/lib/catalog"
import { listProducts, type StoreProduct } from "@/lib/medusa"

export const SITEMAP_CHUNK_SIZE = 5000
const PRODUCT_BATCH_SIZE = 200
const STATIC_URLS = ["/", "/shop/", "/contact/"]

/** Shared by the sitemap index and chunks so their URL counts cannot drift. */
export function buildSitemapUrls(
  products: StoreProduct[],
  devices: DeviceRecord[]
): string[] {
  const urls = new Set(STATIC_URLS)
  const slugByName = new Map(devices.map((device) => [device.name, device.slug]))
  for (const device of devices) urls.add(`/shop/${device.slug}/`)

  for (const product of products) {
    urls.add(`/product/${product.handle}/`)
    const deviceOption = product.options?.find((option) => option.title === "Device")
    if (!deviceOption) continue

    // A device value can exist on the product without a sellable variant. Read
    // the actual variant options; titles also contain the case type and are not
    // device names. The Set deduplicates devices sold in several case types.
    for (const variant of product.variants ?? []) {
      const deviceName = variant.options?.find(
        (option) => option.option_id === deviceOption.id
      )?.value
      const slug = deviceName ? slugByName.get(deviceName) : undefined
      if (slug) urls.add(`/product/${product.handle}-${slug}/`)
    }
  }
  return [...urls]
}

export const getSitemapUrls = cache(async (): Promise<string[]> => {
  try {
    const devicesPromise = getDeviceCatalog()
    const products: StoreProduct[] = []
    let offset = 0
    let count = Infinity
    // Keep batches within listProducts' persistent data-cache limit. Sequential
    // batches avoid a pricing/query burst on the shared application server.
    while (offset < count) {
      const result = await listProducts({
        limit: PRODUCT_BATCH_SIZE,
        offset,
        order: "id",
        fields: "id,handle,options.id,options.title,*variants.options",
      })
      if (result.error) throw new Error(result.error)
      products.push(...result.products)
      count = result.count
      if (!result.products.length) break
      offset += result.products.length
    }
    return buildSitemapUrls(products, await devicesPromise)
  } catch (error) {
    console.error("[sitemap] product fetch failed, emitting static URLs only:", error)
    return [...STATIC_URLS]
  }
})
