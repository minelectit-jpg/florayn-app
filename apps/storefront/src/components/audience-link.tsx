"use client"

import Link from "next/link"
import { forwardRef, type ComponentProps } from "react"

import { withAudience } from "@/lib/audience"
import { useAudience } from "@/components/use-audience"

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string }

/**
 * next/link that keeps the shopper in their mode: in Men, "/shop/…" becomes
 * "/men/shop/…". Content, menus and cards all keep plain paths and render
 * through this, so nothing has to be entered twice in the admin.
 */
const AudienceLink = forwardRef<HTMLAnchorElement, Props>(function AudienceLink({ href, ...props }, ref) {
  const audience = useAudience()
  return <Link ref={ref} href={withAudience(href, audience)} {...props} />
})

export default AudienceLink
