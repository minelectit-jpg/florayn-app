import type { Metadata } from "next"

import ShopFilterPage, { shopFilterMetadata, shopStaticParams } from "@/components/pages/shop-filter-page"

type Params = { params: Promise<{ slug: string[] }> }

// Same caching as the Women shop (app/shop/[...slug]).
export const revalidate = 600
export const dynamicParams = true

export function generateStaticParams() {
  return shopStaticParams()
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return shopFilterMetadata((await params).slug, "men")
}

export default async function MenShopFilterPage({ params }: Params) {
  return <ShopFilterPage slug={(await params).slug} audience="men" />
}
