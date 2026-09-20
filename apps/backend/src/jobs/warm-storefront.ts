import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { setTimeout as delay } from "node:timers/promises"

/**
 * Keep the Next ISR route cache warm for commonly used product device URLs,
 * shop and home page, so a real visitor almost never triggers a cold render.
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
    const urls = [
      "/",
      "/shop/iphone-17-pro-max/signature/",
      "/shop/iphone-16-pro-max/signature/",
      "/shop/airpods-pro-3/signature-earbuds/",
    ]
    for (const p of products) {
      const meta = (p.metadata ?? {}) as Record<string, any>
      const form = String(meta.form ?? "")
      const devs = DEVICES_BY_FORM[form]
      if (!devs || !p.handle) continue
      const caseParam = form === "airpods" ? "signature-earbuds" : "signature"
      for (const dv of devs) urls.push(`/product/${p.handle}-${dv}/?case=${caseParam}`)
    }

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
          headers: HEADERS,
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
