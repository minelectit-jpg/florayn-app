"use client"

import { usePathname } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { AUDIENCE_COOKIE, audienceFromPath, type Audience } from "@/lib/audience"

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

function readCookie(): Audience {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${AUDIENCE_COOKIE}=(women|men)`))
    return match?.[1] === "men" ? "men" : "women"
  } catch {
    return "women"
  }
}

/** Remember the mode for the shared pages (cart, contact, account). */
export function rememberAudience(audience: Audience) {
  try {
    if (readCookie() === audience) return
    document.cookie = `${AUDIENCE_COOKIE}=${audience}; path=/; max-age=31536000; samesite=lax`
    notify()
  } catch {
    // Storage blocked: the URL still carries the mode everywhere it matters.
  }
}

/*
 * A switch in flight. Between pressing WOMEN / MEN and the new page arriving,
 * the old page is still on screen; every link reads this so a click in that
 * moment (pagination, the menu) lands in the chosen mode, not the old one.
 */
let switching: Audience | null = null
let switchTimer: ReturnType<typeof setTimeout> | undefined

export function setSwitchingAudience(audience: Audience | null) {
  clearTimeout(switchTimer)
  if (audience) {
    // Never leave the page dimmed if the navigation fails.
    switchTimer = setTimeout(() => setSwitchingAudience(null), 12_000)
    document.documentElement.dataset.audienceSwitch = audience
  } else {
    delete document.documentElement.dataset.audienceSwitch
  }
  if (switching === audience) return
  switching = audience
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The shopping mode for the current page: a switch in flight first, then the
 * URL's mode (/men/… or the Women root pages), and on a shared page (cart,
 * contact) the last mode the shopper chose. The server always renders Women for
 * a shared page and the remembered mode takes over right after hydration,
 * without a mismatch.
 */
export function useAudience(): Audience {
  const pathname = usePathname()
  const fromPath = audienceFromPath(pathname)
  const remembered = useSyncExternalStore(subscribe, readCookie, () => "women" as Audience)
  const pending = useSyncExternalStore(subscribe, () => switching, () => null)

  useEffect(() => {
    if (fromPath) rememberAudience(fromPath)
  }, [fromPath])

  return pending ?? fromPath ?? remembered
}
