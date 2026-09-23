"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, type MouseEvent } from "react"

import { AUDIENCES, switchAudiencePath, type Audience } from "@/lib/audience"
import { rememberAudience, useAudience } from "@/components/use-audience"

const LABEL: Record<Audience, string> = { women: "Women", men: "Men" }

/**
 * The WOMEN / MEN switch. It opens the same page in the other mode (an iPhone
 * 17 Pro Max shop stays an iPhone 17 Pro Max shop), keeping any ?case= query.
 *
 * The highlight slides the moment it is pressed and the page follows, so it
 * never feels stuck while the next page loads. `pill` is the desktop header
 * control; `tabs` is the full-width bar used on phones.
 */
export default function AudienceToggle({ variant, className = "" }: { variant: "pill" | "tabs"; className?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const audience = useAudience()
  const [pending, setPending] = useState<Audience | null>(null)
  const shown = pending ?? audience

  // Once the new page is in, the URL is the source of truth again.
  useEffect(() => setPending(null), [pathname])

  function choose(target: Audience, event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    if (target === shown) return
    setPending(target)
    rememberAudience(target)
    router.push(switchAudiencePath(`${window.location.pathname}${window.location.search}`, target))
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
          onClick={(event) => choose(option, event)}
          className="fl-audience__option"
        >
          {LABEL[option]}
        </Link>
      ))}
    </nav>
  )
}
