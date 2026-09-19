import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/**
 * Keep the Cloudflare edge (and the Next ISR route cache) HOT for every product,
 * shop and home page, so a real visitor almost never triggers a cold render.
 *
 * CF's free plan has no async stale-while-revalidate: once an edge entry's TTL
 * lapses, the NEXT request revalidates synchronously against origin (~1s cold).
 * This job runs frequently enough (every 20 min, vs the 2h edge TTL) that it is
 * usually the one that eats that revalidation just after a page expires, not a
 * customer. Pages that are still fresh return an instant edge HIT, so a run is
 * cheap when everything is already warm.
 *
 * It warms with `Sec-Fetch-Dest: document` — the exact signal the CF cache rule
 * keys on — so only the full-page HTML variant is warmed (RSC nav is untouched).
 */
const STOREFRONT = process.env.STOREFRONT_URL || "https://new.florayn.com"
// The two devices the shop grid + menu link to (the real document landings).
const DEVICES = ["iphone-17-pro-max", "iphone-16-pro-max"]
const CONCURRENCY = 3
const HEADERS = {
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "User-Agent": "Mozilla/5.0 (florayn-warm-job)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Encoding": "gzip, br",
}

export default async function warmStorefront(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const productModule = container.resolve(Modules.PRODUCT)

  // Every live phone design (its slug), from product metadata.
  const products = await productModule.listProducts(
    {},
    { select: ["metadata"], take: 10000 }
  )
  const slugs = new Set<string>()
  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, any>
    if (meta.form === "phone" && meta.design_slug) slugs.add(meta.design_slug)
  }

  const urls = ["/"]
  for (const dv of DEVICES) {
    urls.push(`/shop/${dv}/signature/`)
    for (const slug of slugs) urls.push(`/product/${slug}-${dv}/?case=signature`)
  }

  let i = 0
  let hit = 0
  let warmed = 0
  let bad = 0
  const start = Date.now()

  async function worker() {
    while (i < urls.length) {
      const u = urls[i++]
      try {
        const r = await fetch(`${STOREFRONT}${u}`, {
          headers: HEADERS,
          redirect: "manual",
        })
        const cf = (r.headers.get("cf-cache-status") || "").toUpperCase()
        if (cf === "HIT") hit++
        else warmed++
        await r.arrayBuffer().catch(() => {})
        if (r.status >= 400) bad++
      } catch {
        bad++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  logger.info(
    `[warm-storefront] ${urls.length} urls in ${(
      (Date.now() - start) / 1000
    ).toFixed(1)}s — edge HIT=${hit} warmed=${warmed} bad=${bad}`
  )
}

export const config = {
  name: "warm-storefront-edge",
  schedule: "*/20 * * * *", // every 20 minutes (edge TTL is 2h)
}
