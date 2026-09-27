"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { retryImport } from "@/components/header/load-on-intent"
import { isPrivatePath } from "@/lib/tracking/paths"
import { fl, track } from "@/lib/tracking/queue"

/*
 * The layout's tracker (TRACKING.md 5.1). It renders nothing, holds no vendor
 * code and only records: a PageView per public pathname and, on the first,
 * the landing address as it was. At the first idle moment it loads
 * lib/tracking/boot.ts, which asks /api/t/id/, beacons unsent events when the
 * page hides and loads the lazy runtime. It is in every page's layout chunk
 * (one 1,200 B gzip budget with queue.ts and paths.ts), so event ids, the URL
 * allowlists and all sending wait in the lazy chunks, and it touches no
 * window until an effect runs.
 */

/** The pathname last seen, so StrictMode's second effect run records nothing. */
let lastPath: string | undefined

/** requestIdleCallback (2 s at most), else the next task. */
function idle(run: () => void) {
  if (typeof window.requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run)
}

/** The id call, once per document, from boot.ts; a failed load leaves tracking off. */
function identify() {
  retryImport(() => import("@/lib/tracking/boot"), false).then((m) => m.identify()).catch(() => {})
}

/**
 * The pathname effect: one PageView per public pathname, nothing on /order,
 * /review or /account. The first public one also keeps the landing (search,
 * referrer and path, unparsed), and each public one schedules the id call
 * until it has gone.
 */
export function onPath(pathname: string): void {
  if (pathname === lastPath) return
  lastPath = pathname
  const state = fl()
  if (!isPrivatePath(pathname)) {
    const first = !state.landing
    if (first) state.landing = { search: location.search, ref: document.referrer, path: location.pathname }
    track("PageView", { first })
    if (!state.cfgPromise) idle(identify)
  }
  try {
    state.wake?.()
  } catch {
    // A runtime error never reaches the page.
  }
}

export default function TrackerStub() {
  const pathname = usePathname()
  useEffect(() => onPath(pathname), [pathname])
  return null
}
