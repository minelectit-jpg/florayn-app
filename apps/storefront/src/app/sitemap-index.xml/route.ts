import { getSitemapUrls, SITEMAP_CHUNK_SIZE } from "@/lib/sitemap-urls"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://florayn.com"

/**
 * The sitemap index.
 *
 * `generateSitemaps` in app/sitemap.ts serves the chunks at /sitemap/0.xml
 * onward but does not produce an index outside Vercel, so /sitemap.xml is a
 * 404. This emits the index the chunks need, and robots.txt points here.
 */
export const revalidate = 86400

export async function GET() {
  const urls = await getSitemapUrls()
  const chunks = Math.max(1, Math.ceil(urls.length / SITEMAP_CHUNK_SIZE))
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
