/**
 * The page's tracking queue (TRACKING.md 5.1): components push, the lazy
 * chunks send. It ships in the layout chunk and again in every page chunk
 * that tracks, so it only records, at call time, the raw address and the
 * time. batch.ts gives each event its id and cuts the address to its safe
 * path before anything leaves the tab, and the runtime does that the moment
 * it starts, before any vendor script loads. No top-level window access.
 */
import type { BrowserEventName, IdResponse, PurchaseBlock } from "./contract"
import { isPrivatePath } from "./paths"

/**
 * id: given (InitiateCheckout's ic- id, a Purchase's fl- id), else added by
 * batch.ts prepare(). p: the pathname and query as they were, until then.
 * s: server copy handed off (a Purchase from birth).
 */
export type QueueItem = { n: BrowserEventName | "Purchase"; id?: string; t: number; p: string; d?: Record<string, unknown>; s?: 1 }
/** The first public page's address and referrer, unparsed; boot.ts sends only the allowlisted parts. */
export type RawLanding = { search: string; ref: string; path: string }
export type FlState = { q: QueueItem[]; landing: RawLanding | null; cfg: IdResponse | null; cfgPromise?: Promise<IdResponse>; wake?: () => void }

declare global {
  interface Window { __fl?: FlState }
}

export function fl(): FlState {
  const blank = { q: [], landing: null, cfg: null }
  return typeof window === "undefined" ? blank : (window.__fl ||= blank)
}

const here = () => location.pathname + location.search

/** Nothing on the server or on a private page. */
export function track(name: BrowserEventName, data?: Record<string, unknown>, id?: string): void {
  if (typeof window === "undefined" || isPrivatePath(location.pathname)) return
  fl().q.push({ n: name, id, t: Date.now(), p: here(), d: data })
}

/** Vendors fire it at once, before checkout leaves /checkout/. */
export function trackPurchase(block: PurchaseBlock): void {
  if (typeof window === "undefined") return
  fl().q.push({ n: "Purchase", id: block.event_id, t: Date.now(), p: here(), d: block, s: 1 })
  try { fl().wake?.() } catch { /* never break checkout */ }
}
