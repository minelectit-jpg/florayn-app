import type { Metadata } from "next"

import ProductPage, { productMetadata, type ProductRouteParams } from "@/components/pages/product-page"

// Same caching as the Women product page (app/product/[slug]): on first hit, then ISR.
export const dynamicParams = true
export const revalidate = 600

export async function generateStaticParams() {
  return [] as { slug: string }[]
}

export function generateMetadata(props: ProductRouteParams): Promise<Metadata> {
  return productMetadata(props)
}

export default function MenProductPage(props: ProductRouteParams) {
  return <ProductPage {...props} audience="men" />
}
