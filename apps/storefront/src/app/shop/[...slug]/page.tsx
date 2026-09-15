import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ShopView, { shopMetadata } from "@/components/shop-view"

type Params = { params: Promise<{ slug: string[] }> }

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
