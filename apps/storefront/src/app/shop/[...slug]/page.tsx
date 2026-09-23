import type { Metadata } from "next"

import ShopFilterPage, { shopFilterMetadata, shopStaticParams } from "@/components/pages/shop-filter-page"

type Params = { params: Promise<{ slug: string[] }> }

// ISR: shop pages are cached and rebuilt at most this often, so a menu/ad click
// gets a prebuilt page instead of a fresh server render each time.
export const revalidate = 600
export const dynamicParams = true

export function generateStaticParams() {
  return shopStaticParams()
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return shopFilterMetadata((await params).slug, "women")
}

export default async function WomenShopFilterPage({ params }: Params) {
  return <ShopFilterPage slug={(await params).slug} audience="women" />
}
