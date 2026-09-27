/**
 * Meta's browser pixel for the lazy tracking runtime (TRACKING.md 5.5). load()
 * builds the standard fbq stub with its history listener off (route-change
 * PageViews go to Meta only from the server, C2), queues only the two config
 * calls, and resolves on fbevents.js's onload. fire() hands Meta one queued
 * event; the runtime calls it only once Meta is ready, on the event's own
 * public pathname. The runtime loads Meta only when the id answer says so,
 * which requires Automatic Advanced Matching to be confirmed off (C7).
 */
import type { ReadyItem } from "../batch"
import type { IdResponse, PurchaseBlock } from "../contract"

type Fbq = {
  (...args: unknown[]): void
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  push: Fbq
  loaded: boolean
  version: string
  disablePushState?: boolean
}
type MetaWindow = Window & { fbq?: Fbq; _fbq?: Fbq }
type Line = { id: string; quantity: number; item_price: number }

const SDK = "https://connect.facebook.net/en_US/fbevents.js"

/** An async script at the end of <head>: resolves on onload, rejects on error. Shared by the pixels. */
export function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.async = true
    script.src = src
    script.onload = () => resolve()
    script.onerror = reject
    document.head.appendChild(script)
  })
}

export function load(cfg: IdResponse): Promise<void> {
  const id = cfg.meta?.id ?? ""
  const w = window as MetaWindow
  if (!w.fbq) {
    // The standard base code, without its script tag and without its PageView.
    const fbq = ((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args)
      else fbq.queue.push(args)
    }) as Fbq
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = "2.0"
    fbq.queue = []
    w.fbq = fbq
    w._fbq ||= fbq
  }
  // Before the script runs: fbevents.js reads it once, and its pushState
  // listener would report /order/<id>/ after checkout.
  w.fbq.disablePushState = true
  // The only calls before onload: no automatic events, and no user data.
  w.fbq("set", "autoConfig", false, id)
  w.fbq("init", id)
  return addScript(SDK)
}

/** Queue items carry { id, q, price }; Meta takes contents as { id, quantity, item_price }. */
function lines(d: Record<string, unknown>): Line[] {
  const items = Array.isArray(d.items) ? (d.items as { id: string; q: number; price: number }[]) : []
  return items.map((item) => ({ id: item.id, quantity: item.q, item_price: item.price }))
}

function products(contents: Line[]) {
  return { content_type: "product", content_ids: [...new Set(contents.map((line) => line.id))], contents }
}

export function fire(item: ReadyItem, cfg: IdResponse): void {
  const fbq = (window as MetaWindow).fbq
  if (!fbq || !cfg.meta) return
  const d = item.d ?? {}
  const options = { eventID: item.id }
  if (item.n === "PageView") {
    // Only the document's first PageView: fbevents.js drops repeats (C2).
    if (d.first === true) fbq("track", "PageView", {}, options)
    return
  }
  if (item.n === "Purchase") {
    const block = d as unknown as PurchaseBlock
    const match = block.match?.meta
    // The contact hashes only while share is on; otherwise external_id alone.
    const user = cfg.share ? match : match?.external_id ? { external_id: match.external_id } : undefined
    if (user && Object.keys(user).length) fbq("init", cfg.meta.id, user)
    fbq("track", "Purchase", {
      ...products(block.contents),
      value: block.value,
      currency: "BDT",
      num_items: block.num_items,
      order_id: block.event_id,
    }, options)
    return
  }
  const data: Record<string, unknown> = { ...products(lines(d)), value: d.value, currency: "BDT" }
  if (item.n === "InitiateCheckout" && typeof d.num_items === "number") data.num_items = d.num_items
  fbq("track", item.n, data, options)
}
