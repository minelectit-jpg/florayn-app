import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ShopView, { shopMetadata } from "@/components/shop-view"
import { getDeviceCatalog } from "@/lib/catalog"

type Params = { params: Promise<{ slug: string[] }> }

/**
 * /shop/<device> and /shop/<device>/<case-type> - clean, path-based shop pages.
 * An unknown device 404s so search engines are not fed junk URLs.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  return shopMetadata({ deviceSlug: slug[0], caseTypeSlug: slug[1] })
}

export default async function ShopFilterPage({ params }: Params) {
  const { slug } = await params
  if (!slug.length || slug.length > 2) notFound()

  const [deviceSlug, caseTypeSlug] = slug
  const devices = await getDeviceCatalog()
  if (!devices.some((d) => d.slug === deviceSlug)) notFound()

  return <ShopView deviceSlug={deviceSlug} caseTypeSlug={caseTypeSlug} />
}
