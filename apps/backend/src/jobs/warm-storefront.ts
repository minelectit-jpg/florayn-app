import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { setTimeout as delay } from "node:timers/promises"

import { sortNewestFirst } from "../lib/device-order"
import { CATALOG_MODULE } from "../modules/catalog"
import { CONTENT_MODULE } from "../modules/content"
import { MEN_MENU } from "../modules/content/config"

/**
 * Keep the Next ISR route cache warm for commonly used product device URLs,
 * shop and home page, the search index and pages, and every model page the
 * header menu opens, so a real visitor almost never triggers a cold render.
 *
 * One paced pass every 20 minutes leaves CPU for customer requests. HTML uses
 * Next's own cache/freshness instead of an independent forced Cloudflare TTL.
 * Document requests populate Next's rendered HTML/RSC route cache together.
 */
const STOREFRONT = process.env.STOREFRONT_URL || "https://new.florayn.com"
// The devices real visitors land on per product form (shop grid + menu links +
// the newest AirPods models). Phone AND AirPods products both need warming —
// AirPods pages were being missed, so they rendered cold (~2-7s) for the first
// visitor. Device switching is a client-side RSC nav and does not need warming.
const DEVICES_BY_FORM: Record<string, string[]> = {
  phone: ["iphone-17-pro-max", "iphone-16-pro-max"],
  airpods: ["airpods-pro-3", "airpods-4", "airpods-pro-2", "airpods-3", "airpods-pro"],
}
const REQUEST_INTERVAL_MS = 250
const REQUEST_TIMEOUT_MS = 10_000
const PASS_BUDGET_MS = 18 * 60 * 1000
let running = false
let nextUrlIndex = 0
const HEADERS = {
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "User-Agent": "Mozilla/5.0 (florayn-warm-job)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Encoding": "gzip, br",
}
// The search index is fetched by the page's script, not navigated to: ask for
// it the way a browser's fetch() does, so it takes the same Cloudflare rule
// (the JSON one, not the HTML document one) a shopper's request takes.
const JSON_HEADERS = {
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "User-Agent": HEADERS["User-Agent"],
  Accept: "application/json",
  "Accept-Encoding": "gzip, br",
}
const SEARCH_INDEX = "/search-index.json"

/** iPhone and Samsung are one product form ("phone"); the other families are their own. */
const formOf = (family: string) => (family === "iphone" || family === "samsung" ? "phone" : family)

/**
 * The shop pages the menu's model lists open, in both modes: for each visible
 * "Device models" section, /shop/<device>/<case type>/ for every active device
 * of its brands, or /shop/<device>/ when the case type does not fit that
 * device (the same rule as shopHref in the storefront's header/nav-model.ts).
 * The Men menu's pages are under /men; an empty Men menu uses the Women one.
 * Newest models first, each page once.
 */
export function menuModelTargets(menuSections: any[], devices: any[], caseTypes: any[]): string[] {
  const forms = new Map<string, Set<string>>(
    caseTypes.map((c) => [c.slug, new Set((c.devices ?? []).map((d: any) => formOf(d.family)))])
  )
  const ordered = sortNewestFirst(devices.filter((d) => d.is_active !== false), (d) => d.name, (d) => d.family)
  const menu = (name: string) => menuSections.filter((s) => s.menu === name && s.is_visible && s.kind === "devices")
    .sort((a, b) => a.position - b.position)
  const women = menu("primary")
  const menOwn = menuSections.some((s) => s.menu === MEN_MENU && s.is_visible)
  const urls = new Set<string>()
  for (const [prefix, sections] of [["", women], ["/men", menOwn ? menu(MEN_MENU) : women]] as const) {
    for (const section of sections) {
      const families: unknown[] = Array.isArray(section.config?.families) ? section.config.families : []
      const caseType: string | null = section.config?.case_type ?? null
      for (const device of ordered) {
        if (!families.includes(device.family)) continue
        const fits = !!caseType && !!forms.get(caseType)?.has(formOf(device.family))
        urls.add(`${prefix}/shop/${device.slug}/${fits ? `${caseType}/` : ""}`)
      }
    }
  }
  return [...urls]
}

/** The menu's model pages; the warm list does without them if they cannot be read. */
async function readMenuModelTargets(container: MedusaContainer): Promise<string[]> {
  const content: any = container.resolve(CONTENT_MODULE)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const [menuSections, devices, caseTypes] = await Promise.all([
    content.listMenuSections({}, { take: 500 }),
    catalog.listDevices({ is_active: true }, { select: ["slug", "name", "family", "is_active"], take: 1000 }),
    catalog.listCaseTypes({ is_active: true }, { relations: ["devices"], take: 500 }),
  ])
  return menuModelTargets(menuSections ?? [], devices ?? [], caseTypes ?? [])
}

export default async function warmStorefront(container: MedusaContainer) {
  const logger = container.resolve("logger")
  if (running) {
    logger.info("[warm-storefront] skipped: previous pass is still active")
    return
  }
  running = true
  const start = Date.now()
  const deadline = start + PASS_BUDGET_MS
  try {
    const productModule = container.resolve(Modules.PRODUCT)
    const products = await productModule.listProducts(
      {},
      { select: ["handle", "metadata"], take: 10000, order: { handle: "ASC" } }
    )

    // AirPods sell the "Signature Earbuds" construction, not the phone Signature,
    // so their shop and product URLs carry that case slug — warm the exact URL a
    // real AirPods visitor lands on, or it renders cold on the first hit.
    const pages = [
      "/",
      "/shop/iphone-17-pro-max/signature/",
      "/shop/iphone-16-pro-max/signature/",
      "/shop/airpods-pro-3/signature-earbuds/",
      // The Men site (/men) has its own home and shop pages.
      "/men/",
      "/men/shop/iphone-17-pro-max/signature/",
      "/men/shop/airpods-pro-3/signature-earbuds/",
      // Search: the index the search sheet loads, and the static results pages.
      SEARCH_INDEX,
      "/search/",
      "/men/search/",
    ]
    // Every model page the menu opens, in both modes.
    const menuTargets = await readMenuModelTargets(container).catch((error) => {
      logger.info(`[warm-storefront] menu models skipped: ${error?.message ?? error}`)
      return [] as string[]
    })
    pages.push(...menuTargets)
    for (const p of products) {
      const meta = (p.metadata ?? {}) as Record<string, any>
      const form = String(meta.form ?? "")
      const devs = DEVICES_BY_FORM[form]
      if (!devs || !p.handle) continue
      const caseParam = form === "airpods" ? "signature-earbuds" : "signature"
      for (const dv of devs) pages.push(`/product/${p.handle}-${dv}/?case=${caseParam}`)
      // A men's design is mostly opened from the Men site: warm its main phone page there.
      if (form === "phone" && meta.audience !== "women") pages.push(`/men/product/${p.handle}-${devs[0]}/?case=${caseParam}`)
    }

    // A menu page can repeat a fixed one (/shop/iphone-17-pro-max/signature/).
    const urls = [...new Set(pages)]
    nextUrlIndex %= urls.length
    let processed = 0
    let hit = 0
    let warmed = 0
    let bad = 0

    // One request at a time leaves CPU for customers. A partial pass resumes at
    // its next URL on the following run, so slow early pages cannot starve the
    // tail of the catalogue. The guard is shared by runs in this worker process.
    while (processed < urls.length && Date.now() < deadline) {
      const u = urls[nextUrlIndex]
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break
      try {
        const r = await fetch(`${STOREFRONT}${u}`, {
          headers: u === SEARCH_INDEX ? JSON_HEADERS : HEADERS,
          redirect: "manual",
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
        })
        const cached = (r.headers.get("x-nextjs-cache") || r.headers.get("cf-cache-status") || "").toUpperCase()
        if (cached === "HIT") hit++
        else warmed++
        await r.arrayBuffer()
        if (r.status >= 400) bad++
      } catch {
        bad++
      }
      processed++
      nextUrlIndex = (nextUrlIndex + 1) % urls.length
      if (processed < urls.length) {
        const pauseMs = Math.min(REQUEST_INTERVAL_MS, Math.max(0, deadline - Date.now()))
        if (pauseMs) await delay(pauseMs)
      }
    }

    logger.info(
      `[warm-storefront] processed=${processed}/${urls.length} remaining=${urls.length - processed} ` +
      `next=${nextUrlIndex} in ${((Date.now() - start) / 1000).toFixed(1)}s — ` +
      `cache HIT=${hit} warmed=${warmed} bad=${bad}`
    )
  } finally {
    running = false
  }
}

export const config = {
  name: "warm-storefront-edge",
  schedule: "*/20 * * * *",
}
