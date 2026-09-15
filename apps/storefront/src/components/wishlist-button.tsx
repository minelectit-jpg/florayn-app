"use client"

import { Heart } from "lucide-react"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * The heart button beside Add to cart, matching florayn's 50x50 outline icon.
 * Wishlist lives in localStorage (no account system yet), keyed by the product
 * handle; a future wishlist page can read the same store. Every button on the
 * page stays in sync through a window event.
 */
const KEY = "florayn:wishlist"
const EVENT = "florayn:wishlist"

export type WishlistEntry = {
  handle: string
  title: string
  thumbnail?: string | null
}

function readAll(): Record<string, WishlistEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}")
  } catch {
    return {}
  }
}

function writeAll(value: Record<string, WishlistEntry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* storage may be unavailable (private mode) - fail quietly */
  }
  window.dispatchEvent(new Event(EVENT))
}

export default function WishlistButton({
  handle,
  title,
  thumbnail,
}: WishlistEntry) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const sync = () => setActive(!!readAll()[handle])
    sync()
    window.addEventListener(EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [handle])

  function toggle() {
    const all = readAll()
    if (all[handle]) delete all[handle]
    else all[handle] = { handle, title, thumbnail: thumbnail ?? null }
    writeAll(all)
    setActive(!!readAll()[handle])
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      aria-label={active ? "Remove from wishlist" : "Add to wishlist"}
      title={active ? "Remove from wishlist" : "Add to wishlist"}
      className={cn(
        "grid size-[50px] shrink-0 place-items-center rounded-[30px] border transition-colors",
        active
          ? "border-purple text-purple"
          : "border-line text-ink-muted hover:border-ink hover:text-ink"
      )}
    >
      <Heart
        className="size-[18px]"
        fill={active ? "currentColor" : "none"}
        strokeWidth={1.6}
      />
    </button>
  )
}
