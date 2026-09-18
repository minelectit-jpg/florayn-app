import type { MetadataRoute } from "next"

import { getDeviceCatalog } from "@/lib/catalog"
import { listProducts } from "@/lib/medusa"
import { buildVariantMatrix } from "@/lib/variant-matrix"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://florayn.com"
const CHUNK = 5000

/**
 * 13,041 device pages plus the base products is far past what belongs in one
 * file, so the sitemap is split. Next serves these as /sitemap/0.xml,
 * /sitemap/1.xml and so on, with an index at /sitemap.xml.
 */
export async function generateSitemaps() {
  const total = await countUrls()
  const chunks = Math.max(1, Math.ceil(total / CHUNK))
  return Array.from({ length: chunks }, (_, id) => ({ id }))
}

async function allUrls(): Promise<string[]> {
  const staticUrls: string[] = ["/", "/shop/", "/contact/"]
  try {
    const [{ products }, devices] = await Promise.all([
      // Only what buildVariantMatrix needs: options + variant options. NEVER the
      // default fields here - pulling calculated_price for 600 products x ~100
      // variants took >120s and failed the whole production build (and jammed the
      // backend's DB pool). This query must stay light.
      listProducts({
        limit: 600,
        fields: "handle,*options,*options.values,*variants.options",
      }),
      getDeviceCatalog(),
    ])
    const slugByName = new Map(devices.map((d) => [d.name, d.slug]))

    const urls = [...staticUrls]
    // Clean per-device landing pages (/shop/<device>/) - the entry points search
    // engines should index over the old ?filter_device= query URLs.
    for (const device of devices) urls.push(`/shop/${device.slug}/`)
    for (const product of products) {
      urls.push(`/product/${product.handle}/`)
      // One device page per device the product is sold for. Devices come from the
      // (Case Type x Device) matrix, deduped, since case types share devices.
      for (const deviceName of buildVariantMatrix(product).devices) {
        const slug = slugByName.get(deviceName)
        if (slug) urls.push(`/product/${product.handle}-${slug}/`)
      }
    }
    return urls
  } catch (error) {
    // A slow/unreachable backend during a build must NOT fail the build over the
    // sitemap - emit the static entry points and move on.
    console.error("[sitemap] product fetch failed, emitting static URLs only:", error)
    return staticUrls
  }
}

async function countUrls() {
  return (await allUrls()).length
}

export default async function sitemap({
  id,
}: {
  id: number
}): Promise<MetadataRoute.Sitemap> {
  const urls = await allUrls()
  return urls.slice(id * CHUNK, (id + 1) * CHUNK).map((url) => ({
    url: `${SITE}${url}`,
    lastModified: new Date(),
    // Landing/base pages are the entry points; a per-device PRODUCT page is a
    // long-tail target and says so. Shop device landings sit in between.
    priority: url.startsWith("/product/") && url.split("-").length > 3
      ? 0.5
      : url.startsWith("/shop/") && url !== "/shop/"
        ? 0.7
        : 0.8,
  }))
}
