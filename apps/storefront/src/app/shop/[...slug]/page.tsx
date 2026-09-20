import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ShopView, { shopMetadata } from "@/components/shop-view"
import { getDeviceCatalog } from "@/lib/catalog"

type Params = { params: Promise<{ slug: string[] }> }

// ISR: shop pages are cached and rebuilt at most this often, so a menu/ad click
// gets a prebuilt page instead of a fresh server render each time.
export const revalidate = 600
export const dynamicParams = true

// Prerender the per-device shop pages (page 1) so device links land on a cached
// page; device+case-type and deeper pages generate on first hit and then cache.
export async function generateStaticParams() {
  try {
    const devices = await getDeviceCatalog()
    return devices
      .map((d) => d.slug)
      .filter(Boolean)
      .map((slug) => ({ slug: [slug] }))
  } catch {
    return [] as { slug: string[] }[]
  }
}

/**
 * Parse the catch-all into device / case type / page. Page paging is path-based
 * (…/signature/2) so each page is its own cacheable route; a trailing number is
 * always the page, never a case type.
 */
function parse(slug: string[]): {
  deviceSlug?: string
  caseTypeSlug?: string
  page: number
} | null {
  if (!slug.length || slug.length > 3) return null
  const [a, b, c] = slug
  const isNum = (s?: string) => !!s && /^\d+$/.test(s)

  if (slug.length === 1) return { deviceSlug: a, page: 1 }
  if (slug.length === 2) {
    return isNum(b)
      ? { deviceSlug: a, page: Number(b) }
      : { deviceSlug: a, caseTypeSlug: b, page: 1 }
  }
  // length 3: device / case type / page
  if (!isNum(c)) return null
  return { deviceSlug: a, caseTypeSlug: b, page: Number(c) }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const parsed = parse(slug)
  return shopMetadata({
    deviceSlug: parsed?.deviceSlug,
    caseTypeSlug: parsed?.caseTypeSlug,
  })
}

export default async function ShopFilterPage({ params }: Params) {
  const { slug } = await params
  const parsed = parse(slug)
  if (!parsed) notFound()

  return (
    <ShopView
      deviceSlug={parsed.deviceSlug}
      caseTypeSlug={parsed.caseTypeSlug}
      page={parsed.page}
      routePath={`/shop/${slug.join("/")}/`}
    />
  )
}
