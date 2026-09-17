import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ShopView, { shopMetadata } from "@/components/shop-view"
import { getDeviceCatalog } from "@/lib/catalog"

type Params = { params: Promise<{ slug: string[] }> }

// ISR: shop pages are cached and rebuilt at most this often, so a menu/ad click
// gets a prebuilt page instead of a fresh server render each time.
export const revalidate = 600
export const dynamicParams = true

// Prerender the per-device shop pages so device links land on a cached page;
// device+case-type pages generate on first hit and then cache.
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
 * /shop/<device> and /shop/<device>/<case-type> - clean, path-based shop pages.
 * A slug that is not a live device still renders (ShopView drops the filter),
 * and its canonical points back at /shop/, so a menu link to a device that was
 * later turned off does not 404 - it just falls back to the wider shop.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  return shopMetadata({ deviceSlug: slug[0], caseTypeSlug: slug[1] })
}

export default async function ShopFilterPage({ params }: Params) {
  const { slug } = await params
  if (!slug.length || slug.length > 2) notFound()

  const [deviceSlug, caseTypeSlug] = slug
  return <ShopView deviceSlug={deviceSlug} caseTypeSlug={caseTypeSlug} />
}
