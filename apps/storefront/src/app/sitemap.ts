import type { MetadataRoute } from "next"

import { getSitemapUrls, SITEMAP_CHUNK_SIZE } from "@/lib/sitemap-urls"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://florayn.com"

/**
 * 13,041 device pages plus the base products is far past what belongs in one
 * file, so the sitemap is split. Next serves these as /sitemap/0.xml,
 * /sitemap/1.xml and so on, with an index at /sitemap.xml.
 */
export async function generateSitemaps() {
  const total = (await getSitemapUrls()).length
  const chunks = Math.max(1, Math.ceil(total / SITEMAP_CHUNK_SIZE))
  return Array.from({ length: chunks }, (_, id) => ({ id }))
}

export default async function sitemap({
  id,
}: {
  id: number
}): Promise<MetadataRoute.Sitemap> {
  const urls = await getSitemapUrls()
  return urls.slice(id * SITEMAP_CHUNK_SIZE, (id + 1) * SITEMAP_CHUNK_SIZE).map((url) => ({
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
