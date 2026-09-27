/**
 * The Google Ads tag for the lazy tracking runtime (TRACKING.md 5.5). It only
 * ever sends the Purchase conversion; the id answer offers it only on live
 * hosts, to visitors from a Google ad. load() queues consent, js and config
 * (no page view) and resolves on gtag.js's onload. The conversion's
 * page_location is always /checkout/, never the order page (invariant 4).
 */
import type { ReadyItem } from "../batch"
import type { ClickKey, IdResponse, PurchaseBlock } from "../contract"
import { addScript } from "./meta"

type GoogleWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }

const GOOGLE_CLICKS: readonly ClickKey[] = ["gclid", "gbraid", "wbraid"]

export function load(cfg: IdResponse): Promise<void> {
  const id = cfg.google?.id ?? ""
  const w = window as GoogleWindow
  const layer = (w.dataLayer ||= [])
  // gtag.js reads Arguments objects from dataLayer, not arrays.
  w.gtag = function () {
    layer.push(arguments)
  }
  // Enhanced conversions stay off while contact sharing is off (section 12).
  if (!cfg.share) w.gtag("consent", "default", { ad_user_data: "denied" })
  w.gtag("js", new Date())
  const config: Record<string, unknown> = { send_page_view: false }
  // The address bar no longer has the click id (another page, or it was
  // scrubbed): give gtag the landing URL so its conversion linker sees it.
  const click = cfg.landing?.click
  if (click && GOOGLE_CLICKS.includes(click) && cfg.landing?.url && !new URLSearchParams(location.search).has(click)) {
    config.page_location = cfg.landing.url
  }
  w.gtag("config", id, config)
  return addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`)
}

export function fire(item: ReadyItem, cfg: IdResponse): void {
  const gtag = (window as GoogleWindow).gtag
  if (item.n !== "Purchase" || !gtag || !cfg.google) return
  const block = item.d as unknown as PurchaseBlock
  if (cfg.share && block.match?.google) gtag("set", "user_data", block.match.google)
  gtag("event", "conversion", {
    send_to: `${cfg.google.id}/${cfg.google.label}`,
    value: block.value,
    currency: "BDT",
    transaction_id: block.event_id,
    page_location: `https://${location.host}/checkout/`,
  })
}
