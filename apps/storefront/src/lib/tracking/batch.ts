/**
 * Queued events on their way out (TRACKING.md 5.1, 5.2): boot.ts's pagehide
 * beacon and the runtime's batches both take them here. Lazy chunks only:
 * queue.ts records raw items in the layout chunk, and this is where they get
 * their event id and their safe path.
 */
import { safePath } from "./contract"
import { fl, type QueueItem } from "./queue"

/** A queued item after prepare(): it has its event id and its safe path. */
export type ReadyItem = QueueItem & { id: string }

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

/**
 * Makes a queued item sendable, in place and idempotent: an event id (one for
 * the server copy and every vendor copy) and its path cut to safePath form,
 * so the raw address (review tokens, click ids) stays nowhere in the queue.
 */
export function prepare(item: QueueItem): ReadyItem {
  item.id ||= newEventId()
  const at = item.p.indexOf("?")
  item.p = at < 0 ? safePath(item.p) : safePath(item.p.slice(0, at), item.p.slice(at))
  return item as ReadyItem
}

/** Up to `max` browser events not handed off yet, prepared and marked handed off. Never a Purchase. */
export function takeUnsent(max = 25): ReadyItem[] {
  const out = fl().q.filter((item) => !item.s && item.n !== "Purchase").slice(0, max).map(prepare)
  for (const item of out) item.s = 1
  return out
}

/** After a failed send, so the next batch retries them. */
export function restoreUnsent(items: QueueItem[]): void {
  for (const item of items) if (item.n !== "Purchase") delete item.s
}
