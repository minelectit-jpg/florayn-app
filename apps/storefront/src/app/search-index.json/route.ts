import { unstable_cache } from "next/cache"

import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "@/lib/medusa"

/**
 * The search index (lib/search/types.ts), edge-cached for the browser, which
 * fetches it once on the first sign of wanting to search.
 *
 * A dotted folder, like sitemap-index.xml: trailingSlash does not redirect it
 * (an /api path would 308). The route runs per request so a failed backend
 * read is never frozen into a static file; the body itself comes from the data
 * cache, refreshed every 30 minutes and on any product, catalogue or content
 * save (the tags). fetchIndexText throws on failure, so an error is never
 * cached. Bump the cache key with the index version.
 */
export const dynamic = "force-dynamic"

async function fetchIndexText(): Promise<string> {
  const res = await fetch(`${MEDUSA_BACKEND_URL}/store/search-index`, {
    headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`/store/search-index answered ${res.status}`)
  return res.text()
}

const cachedIndexText = unstable_cache(fetchIndexText, ["search-index-v2"], {
  revalidate: 1800,
  tags: ["products", "catalog", "content"],
})

export async function GET() {
  try {
    return new Response(await cachedIndexText(), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
      },
    })
  } catch (error) {
    console.error(`[search-index] ${error instanceof Error ? error.message : String(error)}`)
    return Response.json({ v: 0 }, { status: 503, headers: { "cache-control": "no-store" } })
  }
}
