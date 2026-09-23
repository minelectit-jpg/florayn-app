"use client"

import { usePathname } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { AUDIENCE_COOKIE, audienceFromPath, type Audience } from "@/lib/audience"

const listeners = new Set<() => void>()

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
    listeners.forEach((notify) => notify())
  } catch {
    // Storage blocked: the URL still carries the mode everywhere it matters.
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

/**
 * The shopping mode for the current page. On /men/… and the Women root pages
 * it is the URL's; on a shared page (cart, contact) it is the last mode the
 * shopper chose. The server always renders Women for a shared page and the
 * remembered mode takes over right after hydration, without a mismatch.
 */
export function useAudience(): Audience {
  const pathname = usePathname()
  const fromPath = audienceFromPath(pathname)
  const remembered = useSyncExternalStore(subscribe, readCookie, () => "women" as Audience)

  useEffect(() => {
    if (fromPath) rememberAudience(fromPath)
  }, [fromPath])

  return fromPath ?? remembered
}
