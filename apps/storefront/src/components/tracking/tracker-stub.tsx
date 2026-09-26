"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { retryImport } from "@/components/header/load-on-intent"
import type { IdResponse } from "@/lib/tracking/contract"
import { isPrivatePath, landingParams } from "@/lib/tracking/paths"
import { fl, restoreUnsent, takeUnsent, track } from "@/lib/tracking/queue"

/*
 * The layout's tracker (TRACKING.md 5.1). It renders nothing and holds no
 * vendor code: it queues a PageView per public pathname, asks /api/t/id/ once
 * at the first idle, beacons unsent events when the page hides, and loads the
 * lazy runtime (lib/tracking/runtime.ts) once the page is usable. It is in
 * every page's layout chunk (one 1,200 B gzip budget with queue.ts and
 * paths.ts), so it stays small and touches no window until an effect runs.
 */

/** The pathname last seen, so StrictMode's second effect run records nothing. */
let lastPath: string | undefined
/** /api/t/id/ was called: once per document. */
let asked = false

/** Stored when /api/t/id/ fails: tracking stays off for this document. */
const OFF: IdResponse = {
  v: 1, on: false, env: null, ext: null, sid: null, src: null, staff: false, optout: false, share: false,
  consent_version: 1, landing: null, meta: null, tiktok: null, google: null,
}

/** requestIdleCallback (2 s at most), else the next task. */
function idle(run: () => void) {
  if (typeof window.requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run)
}

/**
 * The pathname effect: one PageView per public pathname, nothing on /order,
 * /review or /account. The first public one also snapshots the landing (the
 * allowlisted params and the referrer's origin only) and asks for the id.
 */
export function onPath(pathname: string): void {
  // Adding the same listener again is a no-op, so this needs no cleanup.
  addEventListener("pagehide", beacon)
  document.addEventListener("visibilitychange", onVisibility)
  if (pathname === lastPath) return
  lastPath = pathname
  const state = fl()
  if (!isPrivatePath(pathname)) {
    const first = !state.landing
    if (first) {
      const ref = /^https?:/.test(document.referrer) ? new URL(document.referrer).origin : null
      state.landing = { q: landingParams(location.search), ref, path: location.pathname }
    }
    track("PageView", { first })
    if (!asked) idle(identify)
  }
  try {
    state.wake?.()
  } catch {
    // A runtime error never reaches the page.
  }
}

/** The id call. Skipped while on a private page; the next public pathname asks again. */
function identify() {
  if (asked || isPrivatePath(location.pathname)) return
  asked = true
  const state = fl()
  state.cfgPromise = fetch("/api/t/id/", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 1, landing: state.landing }),
  })
    .then((res) => res.json())
    .then((cfg: IdResponse) => (cfg?.v === 1 ? cfg : OFF), () => OFF)
    .then((cfg) => {
      scheduleRuntime((state.cfg = cfg))
      return cfg
    })
}

/**
 * The runtime loads only for a tracked browser that has not opted out, and
 * never on Save-Data: at load for a visitor from an ad click, at load + idle
 * on /checkout/, and otherwise at load + 3 s + idle (header-dialogs.tsx).
 */
export function scheduleRuntime(cfg: IdResponse): void {
  if (!cfg.on || cfg.optout || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
  const run = () => {
    retryImport(() => import("@/lib/tracking/runtime"), false).then((m) => m.start()).catch(() => {})
  }
  const loaded = () => {
    if (cfg.landing?.click) run()
    else if (/^\/checkout\/?$/.test(location.pathname)) idle(run)
    else setTimeout(idle, 3000, run)
  }
  if (document.readyState === "complete") loaded()
  else addEventListener("load", loaded, { once: true })
}

/** Unsent events leave with the page (bounces, reloads) with no vendor code; a refused beacon keeps them. */
export function beacon(): void {
  const events = fl().cfg?.on ? takeUnsent(25) : []
  if (!events.length) return
  const body = new Blob([JSON.stringify({ v: 1, sent_at: Date.now(), events })], { type: "text/plain" })
  if (!navigator.sendBeacon?.("/api/t/e/", body)) restoreUnsent(events)
}

function onVisibility() {
  if (document.visibilityState === "hidden") beacon()
}

export default function TrackerStub() {
  const pathname = usePathname()
  useEffect(() => onPath(pathname), [pathname])
  return null
}
