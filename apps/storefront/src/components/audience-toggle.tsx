"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, type MouseEvent } from "react"

import { AUDIENCES, switchAudiencePath, type Audience } from "@/lib/audience"
import { rememberAudience, setSwitchingAudience, useAudience } from "@/components/use-audience"

const LABEL: Record<Audience, string> = { women: "Women", men: "Men" }

const target = (option: Audience) =>
  switchAudiencePath(`${window.location.pathname}${window.location.search}`, option)

/**
 * The WOMEN / MEN switch. It opens the same page in the other mode (an iPhone
 * 17 Pro Max shop stays an iPhone 17 Pro Max shop), keeping any ?case= query.
 *
 * The highlight slides the moment it is pressed. Until the new page is in, the
 * old one is dimmed and not clickable, and every link already points to the
 * chosen mode, so nothing sends the shopper back. The other mode's page starts
 * loading on hover or touch, not on every page view. `pill` is the desktop
 * header control; `tabs` is the full-width bar used on phones.
 */
export default function AudienceToggle({ variant, className = "" }: { variant: "pill" | "tabs"; className?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const shown = useAudience()
  const prefetched = useRef(new Set<string>())

  // Once the new page is in, the URL is the source of truth again.
  useEffect(() => setSwitchingAudience(null), [pathname])

  function warm(option: Audience) {
    if (option === shown) return
    const href = target(option)
    if (prefetched.current.has(href)) return
    prefetched.current.add(href)
    router.prefetch(href)
  }

  function choose(option: Audience, event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    if (option === shown) return
    const href = target(option)
    setSwitchingAudience(option)
    rememberAudience(option)
    router.push(href)
  }

  return (
    <nav aria-label="Shop for" className={`fl-audience fl-audience--${variant} ${className}`} data-audience={shown}>
      <span className="fl-audience__thumb" aria-hidden="true" />
      {AUDIENCES.map((option) => (
        <Link
          key={option}
          href={switchAudiencePath(pathname || "/", option)}
          prefetch={false}
          aria-current={option === shown ? "true" : undefined}
          onPointerEnter={() => warm(option)}
          onTouchStart={() => warm(option)}
          onFocus={() => warm(option)}
          onClick={(event) => choose(option, event)}
          className="fl-audience__option"
        >
          {LABEL[option]}
        </Link>
      ))}
    </nav>
  )
}
