import { getDeviceCatalog } from "@/lib/catalog"
import { listProducts } from "@/lib/medusa"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://florayn.com"
const CHUNK = 5000

/**
 * The sitemap index.
 *
 * `generateSitemaps` in app/sitemap.ts serves the chunks at /sitemap/0.xml
 * onward but does not produce an index outside Vercel, so /sitemap.xml is a
 * 404. This emits the index the chunks need, and robots.txt points here.
 */
export const revalidate = 86400

export async function GET() {
  const [{ products }, devices] = await Promise.all([
    listProducts({ limit: 600 }),
    getDeviceCatalog(),
  ])
  const names = new Set(devices.map((d) => d.name))

  let count = 3 + products.length
  for (const product of products) {
    count += (product.variants ?? []).filter((v) => names.has(v.title)).length
  }
  const chunks = Math.max(1, Math.ceil(count / CHUNK))
  const now = new Date().toISOString()

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    Array.from(
      { length: chunks },
      (_, i) =>
        `  <sitemap><loc>${SITE}/sitemap/${i}.xml</loc><lastmod>${now}</lastmod></sitemap>`
    ).join("\n") +
    `\n</sitemapindex>\n`

  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  })
}
