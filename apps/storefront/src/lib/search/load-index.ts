import type { SearchIndex } from "./types"

/**
 * The search index, fetched once per session on the first sign of wanting to
 * search (a tap, focus or hover on a search field), never on page load and
 * never in the HTML or RSC payload. The header shell imports this file
 * statically, so it stays tiny: the words are worked out in the lazy results
 * chunk by engine.ts prepare(), which caches them per index, so once per
 * session too.
 */
let pending: Promise<SearchIndex> | null = null

export function loadSearchIndex(): Promise<SearchIndex> {
  if (!pending) {
    const request = fetch("/search-index.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search index: ${res.status}`))))
      .then((index: { v?: unknown } | null) =>
        index?.v === 2 ? (index as SearchIndex) : Promise.reject(new Error("search index: unknown version")))
    // A failure is never kept: the next intent asks again.
    request.catch(() => {
      if (pending === request) pending = null
    })
    pending = request
  }
  return pending
}

/** Start the download on intent; a failure surfaces on the next loadSearchIndex(). */
export function preloadSearchIndex(): void {
  loadSearchIndex().catch(() => {})
}
