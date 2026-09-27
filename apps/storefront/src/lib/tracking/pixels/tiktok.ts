/**
 * TikTok's browser pixel for the lazy tracking runtime (TRACKING.md 5.5).
 * load() builds the standard ttq stub WITHOUT the snippet's automatic
 * ttq.page(), adds the loader script itself so its onload can be seen, and
 * resolves once the SDK says it is ready. fire() hands TikTok one queued event.
 *
 * SPA page views: TikTok's pixel reports a PageView on every history change
 * by default, which would report /order/<id>/ after checkout (C3). Checked on
 * 2026-09-27: the Business Help Center article "About Single Page Application
 * pageview measurement for TikTok Pixel" says the feature is on by default and
 * sends the opt-out to developer documentation (portal doc id
 * 1801524003169281), which renders only with script and could not be read; the
 * loader script carries the switch as a server-side pixel setting
 * (HistoryObserver, dynamic_web_pageview), not as a ttq.load() option. No
 * documented load option was found, so none is passed: the owner turns SPA
 * page views, automatic events and automatic advanced matching off in both
 * pixels, and the id answer loads TikTok only once `spa_off_confirmed` is
 * ticked (3.4).
 */
import type { ReadyItem } from "../batch"
import type { IdResponse, PurchaseBlock } from "../contract"
import { addScript } from "./meta"

type Queue = unknown[] & Record<string, unknown>
type Ttq = Queue & {
  methods: string[]
  setAndDefer: (target: Queue, method: string) => void
  instance: (pixel: string) => Queue
  page: () => void
  track: (event: string, properties: Record<string, unknown>, options: { event_id: string }) => void
  identify: (user: Record<string, string>) => void
  ready: (callback: () => void) => void
  _i: Record<string, Queue>
  _t: Record<string, number>
  _o: Record<string, Record<string, unknown>>
}
type TikTokWindow = Window & { ttq?: Ttq; TiktokAnalyticsObject?: string }

const SDK = "https://analytics.tiktok.com/i18n/pixel/events.js"
const METHODS = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group",
  "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"]

export function load(cfg: IdResponse): Promise<void> {
  const id = cfg.tiktok?.id ?? ""
  const w = window as TikTokWindow
  w.TiktokAnalyticsObject = "ttq"
  const ttq = (w.ttq ||= [] as unknown as Ttq)
  ttq.methods = METHODS
  ttq.setAndDefer = (target, method) => {
    target[method] = (...args: unknown[]) => {
      target.push([method, ...args])
    }
  }
  for (const method of METHODS) ttq.setAndDefer(ttq, method)
  ttq.instance = (pixel) => {
    const queue = ttq._i[pixel] || ([] as unknown as Queue)
    for (const method of METHODS) ttq.setAndDefer(queue, method)
    return queue
  }
  // What the snippet's ttq.load(id) records before it adds the script.
  ttq._i = ttq._i || {}
  ttq._i[id] = Object.assign([], { _u: SDK }) as unknown as Queue
  ttq._t = ttq._t || {}
  ttq._t[id] = Date.now()
  ttq._o = ttq._o || {}
  ttq._o[id] = {}
  // events.js is a loader that fetches the SDK itself: until that runs, ttq
  // is still the stub and would replay calls later, on whatever page is then
  // open. So TikTok counts as ready only when the SDK's own ready() fires
  // (asked on window.ttq as it is then, in case the SDK replaced the stub).
  return addScript(`${SDK}?sdkid=${encodeURIComponent(id)}&lib=ttq`).then(
    () => new Promise<void>((resolve) => (window as TikTokWindow).ttq?.ready(() => resolve())),
  )
}

type Content = { content_id: string; quantity: number; price: number }

export function fire(item: ReadyItem, cfg: IdResponse): void {
  const ttq = (window as TikTokWindow).ttq
  if (!ttq) return
  const d = item.d ?? {}
  const options = { event_id: item.id }
  if (item.n === "PageView") {
    ttq.page()
    return
  }
  if (item.n === "Purchase") {
    const block = d as unknown as PurchaseBlock
    const match = block.match?.tiktok
    // The contact hashes only while share is on; otherwise external_id alone.
    const user = cfg.share ? match : match?.external_id ? { external_id: match.external_id } : undefined
    if (user && Object.keys(user).length) ttq.identify(user)
    ttq.track("Purchase", {
      content_type: "product",
      contents: block.contents.map((line): Content => ({ content_id: line.id, quantity: line.quantity, price: line.item_price })),
      value: block.value,
      currency: "BDT",
      num_items: block.num_items,
      order_id: block.event_id,
    }, options)
    return
  }
  const items = Array.isArray(d.items) ? (d.items as { id: string; q: number; price: number }[]) : []
  const properties: Record<string, unknown> = {
    content_type: "product",
    contents: items.map((line): Content => ({ content_id: line.id, quantity: line.q, price: line.price })),
    value: d.value,
    currency: "BDT",
  }
  if (item.n === "InitiateCheckout" && typeof d.num_items === "number") properties.num_items = d.num_items
  ttq.track(item.n, properties, options)
}
