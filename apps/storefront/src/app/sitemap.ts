import type { MetadataRoute } from "next"

import { getDeviceCatalog } from "@/lib/catalog"
import { listProducts } from "@/lib/medusa"

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
  const [{ products }, devices] = await Promise.all([
    listProducts({ limit: 600 }),
    getDeviceCatalog(),
  ])
  const slugByName = new Map(devices.map((d) => [d.name, d.slug]))

  const urls: string[] = ["/", "/shop/", "/contact/"]
  for (const product of products) {
    urls.push(`/product/${product.handle}/`)
    for (const variant of product.variants ?? []) {
      const slug = slugByName.get(variant.title)
      if (slug) urls.push(`/product/${product.handle}-${slug}/`)
    }
  }
  return urls
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
    // The base product and the landing pages are the entry points; a device
    // page is a long-tail target and says so.
    priority: url.split("-").length > 3 ? 0.5 : 0.8,
  }))
}
