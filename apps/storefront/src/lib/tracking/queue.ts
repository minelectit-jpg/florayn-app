/**
 * The page's tracking queue (TRACKING.md 5.1): components push, the lazy
 * runtime sends. In the layout chunk, so no top-level window access.
 */
import type { BrowserEventName, IdResponse, LandingSnapshot, PurchaseBlock } from "./contract"
import { isPrivatePath, safePath } from "./paths"

/** s: server copy handed off (a Purchase from birth). */
export type QueueItem = { n: BrowserEventName | "Purchase"; id: string; t: number; p: string; d?: Record<string, unknown>; s?: 1 }
export type FlState = { q: QueueItem[]; landing: LandingSnapshot | null; cfg: IdResponse | null; cfgPromise?: Promise<IdResponse>; wake?: () => void }

declare global {
  interface Window { __fl?: FlState }
}

export function fl(): FlState {
  const blank = { q: [], landing: null, cfg: null }
  return typeof window === "undefined" ? blank : (window.__fl ||= blank)
}

/** Lower-case uuid v4: randomUUID, else getRandomValues, else Math.random. */
export function newEventId(): string {
  const c = typeof crypto === "undefined" ? undefined : crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16).map(() => Math.random() * 256)
  c?.getRandomValues?.(b)
  b[6] = (b[6] & 15) | 64
  b[8] = (b[8] & 63) | 128
  const hex = Array.from(b, (x) => (x | 256).toString(16).slice(1)).join("")
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-")
}

const here = () => safePath(location.pathname, location.search)

export function track(name: BrowserEventName, data?: Record<string, unknown>, id?: string): void {
  if (typeof window === "undefined" || isPrivatePath(location.pathname)) return
  fl().q.push({ n: name, id: id ?? newEventId(), t: Date.now(), p: here(), d: data })
}

/** Vendors fire it at once, before checkout leaves /checkout/. */
export function trackPurchase(block: PurchaseBlock): void {
  if (typeof window === "undefined") return
  fl().q.push({ n: "Purchase", id: block.event_id, t: Date.now(), p: here(), d: block, s: 1 })
  try { fl().wake?.() } catch { /* never break checkout */ }
}

export function takeUnsent(max = 25): QueueItem[] {
  const out = fl().q.filter((item) => !item.s && item.n !== "Purchase").slice(0, max)
  for (const item of out) item.s = 1
  return out
}

/** After a failed send, so the next batch retries them. */
export function restoreUnsent(items: QueueItem[]): void {
  for (const item of items) if (item.n !== "Purchase") delete item.s
}
