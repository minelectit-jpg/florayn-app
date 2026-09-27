/**
 * The lazy tracking runtime (TRACKING.md 5.2). Only the tracker's boot.ts
 * loads it, through import(), once the page is usable and the id answer says
 * this browser is tracked; nothing imports it statically. It prepares every
 * queued event as it arrives (batch.ts: its id and its safe path), sends them
 * to /api/t/e/ in batches (the server copies) and, where the id answer allows,
 * loads the Meta, TikTok and Google tags and hands each event to them (the
 * browser copies).
 *
 * Invariants 4 and 9: a vendor script is added only on a public path, after
 * `review` and `r` have left the address bar; a vendor is called only after
 * its script loaded, and only while the current pathname is public, equals
 * the queued event's own and carries no `review` or `r`. Otherwise that
 * browser copy is dropped; the server copy still goes.
 */
import { prepare, restoreUnsent, takeUnsent, type ReadyItem } from "./batch"
import type { IdResponse, PurchaseBlock } from "./contract"
import { isPrivatePath, pathnameOf } from "./paths"
import * as google from "./pixels/google"
import * as meta from "./pixels/meta"
import * as tiktok from "./pixels/tiktok"
import { fl, type QueueItem } from "./queue"

/** Sent as `rv` with every batch; the client budget check finds this chunk by it. */
export const RUNTIME_VERSION = "fl-runtime-v1"

type Platform = "meta" | "tiktok" | "google"
type Pixel = { load: (cfg: IdResponse) => Promise<void>; fire: (item: ReadyItem, cfg: IdResponse) => void }
/**
 * One vendor. `state`: 0 waiting for a public page, 1 script loading (or
 * failed: never retried), 2 ready. `at` is its cursor into fl().q; a Purchase
 * queued before `from` came before the vendor was ready and is never replayed.
 */
type Vendor = { name: Platform; pixel: Pixel; state: 0 | 1 | 2; at: number; from: number }

const PIXELS: Record<Platform, Pixel> = { meta, tiktok, google }
const BATCH_MS = 2000
const BATCH_NOW = 10

let started = false
let cfg: IdResponse
let vendors: Vendor[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let queued = false

const isPublicNow = () => !isPrivatePath(location.pathname)

/** A review link's token (`order_<id>.<sig>`) or stars in the address bar. */
function carriesReview(): boolean {
  const params = new URLSearchParams(location.search)
  return params.has("review") || params.has("r")
}

/** Drop the review link's token and stars from the address bar, keeping Next's history state. */
function scrub(): void {
  if (!carriesReview()) return
  const url = new URL(location.href)
  url.searchParams.delete("review")
  url.searchParams.delete("r")
  history.replaceState(history.state, "", url.pathname + url.search + url.hash)
}

export async function start(): Promise<void> {
  if (started) return
  started = true
  const state = fl()
  const answer = state.cfg ?? (await state.cfgPromise)
  if (!answer?.on || answer.optout) return
  cfg = answer
  // The queue holds raw addresses until now: every item gets its id and its
  // safe path before any vendor script can load, and so does each new one.
  const q = state.q
  for (const item of q) prepare(item)
  scrub()
  // Staff browsers still report to the dashboard (flagged there) but load no vendor.
  if (!cfg.staff) {
    vendors = (Object.keys(PIXELS) as Platform[])
      .filter((name) => cfg[name]?.load)
      .map((name) => ({ name, pixel: PIXELS[name], state: 0, at: 0, from: 0 }))
  }
  // track() only pushes, so notice new events here: vendors get them in the
  // same task, and the batch goes out at 10 or after 2 s.
  const push = q.push
  q.push = (...items: QueueItem[]) => {
    const length = push.apply(q, items.map(prepare))
    if (!queued) {
      queued = true
      Promise.resolve().then(() => {
        queued = false
        drain()
        batch()
      })
    }
    return length
  }
  state.wake = drain
  drain()
  batch()
}

/**
 * Give every ready vendor the events after its cursor, and start loading the
 * vendors that wait while the page is public. Called on every pathname change
 * (the stub's wake), synchronously by trackPurchase(), and after each push.
 */
export function drain(): void {
  const q = fl().q
  for (const vendor of vendors) {
    if (vendor.state === 0 && isPublicNow()) {
      vendor.state = 1
      // After the page's own effects of this commit (a review link's form reads
      // its token first), then re-checked: the page may be private by then.
      setTimeout(() => inject(vendor))
    }
    while (vendor.state === 2 && vendor.at < q.length) {
      const index = vendor.at++
      const item = q[index] as ReadyItem // prepared on arrival
      // Each SDK reads location.href when called. A client navigation to a
      // review link (?review=) wakes this before the page has read and dropped
      // the token, so the token is not scrubbed here: that browser copy is dropped.
      if (!isPublicNow() || carriesReview() || location.pathname !== pathnameOf(item.p)) continue
      if (item.n !== "Purchase") call(vendor, item)
      else if (index >= vendor.from) purchase(vendor, item)
    }
  }
}

function inject(vendor: Vendor): void {
  if (!isPublicNow()) {
    vendor.state = 0
    return
  }
  scrub()
  Promise.resolve()
    .then(() => vendor.pixel.load(cfg))
    .then(() => {
      vendor.from = fl().q.length
      vendor.state = 2
      drain()
    }, () => {
      // A blocked or failed script: this vendor stays off for the document.
    })
}

function call(vendor: Vendor, item: ReadyItem): void {
  try {
    vendor.pixel.fire(item, cfg)
  } catch {
    // A vendor error never reaches the page or the other vendors.
  }
}

/** A Purchase once per vendor per tab: sessionStorage `fl_p_<event_id>` lists the vendors that fired it. */
function purchase(vendor: Vendor, item: ReadyItem): void {
  const block = item.d as unknown as PurchaseBlock | undefined
  if (!block?.platforms?.[vendor.name]) return
  const key = `fl_p_${item.id}`
  let fired = ""
  try {
    fired = sessionStorage.getItem(key) ?? ""
  } catch {
    // Storage blocked: fire anyway; each vendor dedupes by event id.
  }
  if (fired.split(",").includes(vendor.name)) return
  call(vendor, item)
  try {
    sessionStorage.setItem(key, fired ? `${fired},${vendor.name}` : vendor.name)
  } catch {
    // As above.
  }
}

/** Send at once when 10 events wait, else within 2 s of the first. */
function batch(): void {
  const waiting = fl().q.filter((item) => !item.s).length
  if (waiting >= BATCH_NOW) send()
  else if (waiting && !timer) timer = setTimeout(send, BATCH_MS)
}

/** The server copies. Purchase never goes here: it is handed off (`s: 1`) from birth. */
function send(): void {
  clearTimeout(timer)
  timer = undefined
  const events = takeUnsent(25)
  if (!events.length) return
  fetch("/api/t/e/", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 1, rv: RUNTIME_VERSION, sent_at: Date.now(), events }),
  }).then((res) => {
    if (res.status >= 500) restoreUnsent(events)
  }, () => restoreUnsent(events))
  batch()
}
