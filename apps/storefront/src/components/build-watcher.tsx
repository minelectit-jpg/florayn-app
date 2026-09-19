"use client"

import { useEffect, useRef } from "react"

/**
 * Keeps a long-open tab from breaking after a deploy.
 *
 * A tab loaded before a deploy still holds the previous build's JS chunk names
 * and server-action ids; after the deploy those 404 / are rejected, which shows
 * up as "Application error" on navigation or "Could not add that to your cart"
 * on a server action - both confusing and both fixed by a plain reload. This
 * watcher compares the build the tab was served (NEXT_PUBLIC_BUILD_ID, inlined
 * at build) against the live server's (/api/build-id) whenever the tab becomes
 * visible or focused, and once a minute, and reloads once if they differ - so a
 * stale tab quietly updates itself before the user hits either failure.
 *
 * It is deliberately silent and defensive: any network hiccup is ignored, and it
 * never reloads more than once.
 *
 * `buildId` is passed from the server layout (which reads it at runtime) rather
 * than read from process.env here: next.config `env` does not reliably inline a
 * var into App-Router client bundles, so the value has to arrive as a prop.
 */
export default function BuildWatcher({ buildId }: { buildId?: string }) {
  const reloadingRef = useRef(false)

  useEffect(() => {
    const mine = buildId
    // No id baked in (dev, or the env was not set) - nothing to compare against.
    if (!mine) return

    let cancelled = false

    async function check() {
      if (cancelled || reloadingRef.current) return
      if (typeof document !== "undefined" && document.hidden) return
      try {
        // Trailing slash: the app uses trailingSlash:true, so the bare path
        // 308-redirects - hit the final URL directly.
        const res = await fetch("/api/build-id/", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as { id?: string }
        const live = data?.id
        if (live && live !== mine) {
          // Reload AT MOST once per live server build. Persist the id we
          // reloaded for in sessionStorage: if the page we get back is still the
          // old build (e.g. an edge-cached HTML the CDN has not refreshed yet, or
          // the server id changed on a restart), a second mount sees the same
          // `live` we already handled and does NOT reload again — without this a
          // persistent old-vs-new mismatch is an infinite reload loop.
          const KEY = "fl-buildwatch-reloaded-for"
          let alreadyFor: string | null = null
          try {
            alreadyFor = window.sessionStorage.getItem(KEY)
          } catch {
            // sessionStorage blocked (private mode): fall back to the per-mount
            // ref only. Worst case one reload per navigation, never a tight loop.
          }
          if (alreadyFor === live) return
          try {
            window.sessionStorage.setItem(KEY, live)
          } catch {
            /* ignore */
          }
          reloadingRef.current = true
          window.location.reload()
        }
      } catch {
        // Offline or a blip - try again on the next trigger.
      }
    }

    const onVisible = () => {
      if (!document.hidden) check()
    }
    // iOS Safari restores a tab from bfcache without firing visibilitychange;
    // pageshow with persisted=true is the reliable signal for that case.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) check()
    }

    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", check)
    window.addEventListener("pageshow", onPageShow)
    const timer = window.setInterval(check, 60000)
    // One check on mount catches a tab restored from bfcache.
    check()

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", check)
      window.removeEventListener("pageshow", onPageShow)
      window.clearInterval(timer)
    }
  }, [buildId])

  return null
}
