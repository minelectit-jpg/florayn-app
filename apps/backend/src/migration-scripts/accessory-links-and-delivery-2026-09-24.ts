import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../modules/content"
import { ACCESSORY_LINKS } from "../modules/content/defaults"

/** The placeholder every accessory pill and tile was seeded with. */
const PLACEHOLDER = "/collection/signature/"
const OLD_DELIVERY = "3 To 5 Days Delivery"
const NEW_DELIVERY = "1–3 Days Delivery"
const OLD_FAQ = "Three to five days across Bangladesh."
const NEW_FAQ = "One to three days across Bangladesh."

/**
 * The old shop link (?filter_device=&filter_case-type=) as its clean path, which
 * saves the redirect. AirPods have their own "signature-earbuds" case type, so
 * an AirPods link seeded with the phone's "signature" goes straight there.
 * Anything else is returned unchanged.
 */
export function cleanShopHref(href: unknown): unknown {
  if (typeof href !== "string" || !href.startsWith("/shop/?")) return href
  const query = new URLSearchParams(href.slice("/shop/?".length))
  const device = query.get("filter_device")
  if (!device || !/^[a-z0-9-]+$/.test(device)) return href
  let caseType = query.get("filter_case-type") ?? ""
  if (caseType && !/^[a-z0-9-]+$/.test(caseType)) return href
  if (device.startsWith("airpods") && caseType === "signature") caseType = "signature-earbuds"
  return caseType ? `/shop/${device}/${caseType}/` : `/shop/${device}/`
}

/** A pill or tile: its placeholder becomes its real page; old shop links get clean. */
function fixItem(item: any): any {
  if (!item || typeof item !== "object") return item
  const target = ACCESSORY_LINKS[String(item.label ?? "").trim().toLowerCase()]
  if (item.href === PLACEHOLDER && target) return { ...item, href: target }
  const href = cleanShopHref(item.href)
  return href === item.href ? item : { ...item, href }
}

/**
 * Follow-up to the September 2026 home rebuild:
 *
 *   - Watch Bands, Card Holder, Magsafe Wallets and Phone Charms on the home
 *     page lead to their own pages instead of the Signature placeholder.
 *   - Legacy /shop/?filter_device= links become clean /shop/<device>/<case>/.
 *   - Delivery now reads 1–3 days (the marquee and the contact FAQ).
 *
 * Only seeded values change; anything the owner has edited is left alone, and
 * a second run changes nothing.
 */
export default async function accessoryLinksAndDelivery({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(CONTENT_MODULE)

  const sections: any[] = await service.listHomeSections({}, { take: 200 })
  for (const section of sections) {
    const config = section.config ?? {}
    let nextConfig = config
    const patch: Record<string, unknown> = {}

    if (section.type === "marquee") {
      if (section.title === OLD_DELIVERY) patch.title = NEW_DELIVERY
      if (Array.isArray(config.items) && config.items.includes(OLD_DELIVERY)) {
        nextConfig = { ...config, items: config.items.map((s: unknown) => (s === OLD_DELIVERY ? NEW_DELIVERY : s)) }
      }
    } else {
      for (const key of ["items", "tiles", "slides"]) {
        if (!Array.isArray(config[key])) continue
        const next = config[key].map(fixItem)
        if (next.some((item: unknown, i: number) => item !== config[key][i])) nextConfig = { ...nextConfig, [key]: next }
      }
    }
    if (nextConfig !== config) patch.config = nextConfig
    const ctaHref = cleanShopHref(section.cta_href)
    if (ctaHref !== section.cta_href) patch.cta_href = ctaHref

    if (Object.keys(patch).length) {
      await service.updateHomeSections({ id: section.id, ...patch })
      logger.info(`[accessory-links] home section ${section.key} updated`)
    }
  }

  const contacts: any[] = await service.listContactSettings({}, { take: 10 })
  for (const contact of contacts) {
    if (!Array.isArray(contact.faqs)) continue
    let changed = false
    const faqs = contact.faqs.map((faq: any) => {
      if (typeof faq?.answer !== "string" || !faq.answer.startsWith(OLD_FAQ)) return faq
      changed = true
      return { ...faq, answer: NEW_FAQ + faq.answer.slice(OLD_FAQ.length) }
    })
    if (changed) {
      await service.updateContactSettings({ id: contact.id, faqs })
      logger.info("[accessory-links] contact FAQ now says one to three days")
    }
  }
}
