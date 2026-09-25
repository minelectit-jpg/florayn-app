"use client"

import { useRouter } from "next/navigation"
import { forwardRef, type ComponentProps, type FocusEvent, type PointerEvent, type TouchEvent } from "react"

import AudienceLink from "@/components/audience-link"
import { useAudience } from "@/components/use-audience"
import { withAudience } from "@/lib/audience"

type Props = Omit<ComponentProps<typeof AudienceLink>, "prefetch">

/** Pages already asked for in this tab, whichever link asked. */
const warmed = new Set<string>()

/**
 * A menu, panel or search link that does not prefetch just for being on
 * screen: an open drawer or panel would otherwise fetch dozens of pages
 * nobody asked for. It starts loading its page on the first sign of a press
 * (pointer down, touch or keyboard focus), once per page per tab, and keeps
 * the shopper's Women/Men mode like every AudienceLink.
 */
const IntentLink = forwardRef<HTMLAnchorElement, Props>(function IntentLink({ href, onPointerDown, onTouchStart, onFocus, ...props }, ref) {
  const router = useRouter()
  const target = withAudience(href, useAudience())

  function warm() {
    if (!target.startsWith("/") || target.startsWith("//") || warmed.has(target)) return
    warmed.add(target)
    router.prefetch(target)
  }

  return (
    <AudienceLink
      ref={ref}
      href={href}
      prefetch={false}
      onPointerDown={(event: PointerEvent<HTMLAnchorElement>) => {
        warm()
        onPointerDown?.(event)
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        warm()
        onTouchStart?.(event)
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        warm()
        onFocus?.(event)
      }}
      {...props}
    />
  )
})

export default IntentLink
