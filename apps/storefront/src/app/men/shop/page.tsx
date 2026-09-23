import type { Metadata } from "next"

import ShopView, { shopMetadata } from "@/components/shop-view"

export async function generateMetadata(): Promise<Metadata> {
  return shopMetadata({ audience: "men" })
}

/** /men/shop: everything for men. The old ?filter_device= links only exist at /shop. */
export default function MenShopPage() {
  return <ShopView audience="men" routePath="/shop/" />
}
