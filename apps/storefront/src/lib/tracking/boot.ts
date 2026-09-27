/**
 * The tracker's lazy half (TRACKING.md 5.1). The stub only records; it loads
 * this chunk at the first idle moment of a public page. It asks /api/t/id/
 * once per document with the landing cut to the allowlisted params and the
 * referrer's origin, beacons unsent events when the page hides, and loads the
 * runtime (lib/tracking/runtime.ts) when the answer says this browser is
 * tracked. Only the stub's import() reaches it.
 */
import { retryImport } from "@/components/header/load-on-intent"

import { restoreUnsent, takeUnsent } from "./batch"
import { inertIdResponse, landingParams, type IdResponse } from "./contract"
import { isPrivatePath } from "./paths"
import { fl } from "./queue"

/** /api/t/id/ was called: once per document. */
let asked = false

/** requestIdleCallback (2 s at most), else the next task. */
function idle(run: () => void) {
  if (typeof window.requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run)
}

/**
 * The id call. Skipped while on a private page: the stub schedules it again
 * on the next public pathname. A failed or malformed answer is stored as the
 * inert one, so tracking stays off for this document.
 */
export function identify(): void {
  if (asked || isPrivatePath(location.pathname)) return
  asked = true
  // Adding the same listener again is a no-op, so these need no cleanup.
  addEventListener("pagehide", beacon)
  document.addEventListener("visibilitychange", onVisibility)
  const state = fl()
  const raw = state.landing
  const landing = raw && {
    q: landingParams(raw.search),
    ref: /^https?:/.test(raw.ref) ? new URL(raw.ref).origin : null,
    path: raw.path,
  }
  const off = inertIdResponse()
  state.cfgPromise = fetch("/api/t/id/", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 1, landing }),
  })
    .then((res) => res.json())
    .then((cfg: IdResponse) => (cfg?.v === 1 ? cfg : off), () => off)
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
