import type { Metadata } from "next"

import ProductPage, { productMetadata, type ProductRouteParams } from "@/components/pages/product-page"

export const dynamicParams = true
// Generate product routes on demand, then reuse the ISR result. The first
// uncached visit still renders the page. `?case=` is read on the client so
// different constructions share the same static route.
export const revalidate = 600

/*
 * No build-time prerender. With the full catalogue live (~180 designs x devices),
 * prerendering every product page at build meant hundreds of heavy renders and
 * hammered the backend until the build failed. Product pages are generated on
 * first hit and then cached (dynamicParams + revalidate); the on-demand render is
 * kept light, so the first visit is quick.
 */
export async function generateStaticParams() {
  return [] as { slug: string }[]
}

export function generateMetadata(props: ProductRouteParams): Promise<Metadata> {
  return productMetadata(props)
}

export default function WomenProductPage(props: ProductRouteParams) {
  return <ProductPage {...props} audience="women" />
}
