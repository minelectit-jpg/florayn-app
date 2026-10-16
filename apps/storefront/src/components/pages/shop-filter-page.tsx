import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import ShopView, { shopMetadata } from "@/components/shop-view"
import { withAudience, type Audience } from "@/lib/audience"
import { getDeviceCatalog, getShopPhoneColours } from "@/lib/catalog"
import { COLOUR_SLUG, shopColourState, shopPath } from "@/lib/phone-colours"

/**
 * /shop/<device>/<case-type>/[<colour>/][<page>/] in either mode. The route
 * files under app/shop and app/men/shop only fix the mode and their cache
 * settings.
 */

// Prerender the per-device shop pages (page 1) so device links land on a cached
// page; device+case-type and deeper pages generate on first hit and then cache.
export async function shopStaticParams(): Promise<{ slug: string[] }[]> {
  try {
    const devices = await getDeviceCatalog()
    return devices
      .map((d) => d.slug)
      .filter(Boolean)
      .map((slug) => ({ slug: [slug] }))
  } catch {
    return []
  }
}

export type ShopSlug = {
  deviceSlug?: string
  caseTypeSlug?: string
  /** A phone colour web name (PHONE_COLOURS.md 7.1); never a number. */
  colourSlug?: string
  page: number
}

/**
 * Parse the catch-all into device / case type / phone colour / page. Paging is
 * path-based (…/signature/2) so each page is its own cacheable route; a
 * trailing number is always the page, never a case type or a colour. A colour
 * web name starts with a letter, so it can never be read as a page.
 *
 *   1 segment   device
 *   2 segments  device + page, or device + case type
 *   3 segments  device + case type + page, or device + case type + colour
 *   4 segments  device + case type + colour + page
 */
export function parseShopSlug(slug: string[]): ShopSlug | null {
  if (!slug.length || slug.length > 4) return null
  const [a, b, c, d] = slug
  const isNum = (s?: string) => !!s && /^\d+$/.test(s)

  if (slug.length === 1) return { deviceSlug: a, page: 1 }
  if (slug.length === 2) {
    return isNum(b)
      ? { deviceSlug: a, page: Number(b) }
      : { deviceSlug: a, caseTypeSlug: b, page: 1 }
  }
  if (slug.length === 3) {
    if (isNum(c)) return { deviceSlug: a, caseTypeSlug: b, page: Number(c) }
    return COLOUR_SLUG.test(c) ? { deviceSlug: a, caseTypeSlug: b, colourSlug: c, page: 1 } : null
  }
  // length 4: device / case type / colour / page
  if (!isNum(d) || !COLOUR_SLUG.test(c)) return null
  return { deviceSlug: a, caseTypeSlug: b, colourSlug: c, page: Number(d) }
}

export async function shopFilterMetadata(slug: string[], audience: Audience): Promise<Metadata> {
  const parsed = parseShopSlug(slug)
  // The canonical URL never has the colour: the default colour's grid is the page.
  return shopMetadata({
    deviceSlug: parsed?.deviceSlug,
    caseTypeSlug: parsed?.caseTypeSlug,
    audience,
  })
}

export default async function ShopFilterPage({ slug, audience }: { slug: string[]; audience: Audience }) {
  const parsed = parseShopSlug(slug)
  if (!parsed) notFound()

  // A colour path only exists for a colour some published design has pictures
  // in, which bounds the ISR entries. The default colour is the colour-less
  // page. If the palette cannot be read, the colour is ignored and the page
  // shows its usual pictures.
  let colourSlug: string | undefined
  if (parsed.colourSlug) {
    const palette = await getShopPhoneColours(parsed.deviceSlug!, parsed.caseTypeSlug!)
    const state = shopColourState(palette, parsed.colourSlug)
    if (state === "missing") notFound()
    if (state === "redirect") redirect(withAudience(shopPath(parsed.deviceSlug, parsed.caseTypeSlug, null, parsed.page), audience))
    if (state === "show") colourSlug = parsed.colourSlug
  }

  return (
    <ShopView
      deviceSlug={parsed.deviceSlug}
      caseTypeSlug={parsed.caseTypeSlug}
      colourSlug={colourSlug}
      page={parsed.page}
      routePath={`/shop/${slug.join("/")}/`}
      audience={audience}
    />
  )
}
