import type { Metadata } from "next"
import Link from "next/link"

import ProductCard from "@/components/product-card"
import { getDeviceCatalog } from "@/lib/catalog"
import { listProducts, sdk, type StoreProduct } from "@/lib/medusa"

type Params = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * /shop/ is where the header menu points. It keeps the live site's query
 * shape - `filter_device` and `filter_case-type`, both slugs - so the links
 * copied from florayn.com work unchanged.
 */
function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

async function categoryIdFor(slug: string): Promise<string | null> {
  if (!slug) return null
  try {
    const { product_categories } = await sdk.store.category.list({
      handle: slug,
      limit: 1,
    })
    return product_categories?.[0]?.id ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({
  searchParams,
}: Params): Promise<Metadata> {
  const query = await searchParams
  const devices = await getDeviceCatalog()
  const device = devices.find((d) => d.slug === first(query.filter_device))
  return {
    title: device ? `${device.name} cases` : "Shop",
    alternates: { canonical: "/shop/" },
  }
}

export default async function ShopPage({ searchParams }: Params) {
  const query = await searchParams
  const deviceSlug = first(query.filter_device)
  const caseTypeSlug = first(query["filter_case-type"])

  const devices = await getDeviceCatalog()
  const device = devices.find((d) => d.slug === deviceSlug) ?? null

  /*
   * Narrowing by case type first keeps the query small: every product carries
   * its case type as a category, and there are only six of them. The limit has
   * to clear the largest case type - Signature, at 165 products - because the
   * device filter runs over what comes back, so anything truncated here would
   * silently vanish from the results.
   */
  const categoryId = await categoryIdFor(caseTypeSlug)
  const { products, count } = await listProducts(
    categoryId ? { category_id: [categoryId], limit: 200 } : { limit: 200 }
  )
  const truncated = count > products.length

  // A device is a variant, so "fits this device" means the product has a
  // variant with that name.
  const filtered: StoreProduct[] = device
    ? products.filter((p) =>
        (p.variants ?? []).some((v) => v.title === device.name)
      )
    : products

  const caseTypeName =
    filtered[0]?.metadata?.case_type_name ??
    products[0]?.metadata?.case_type_name ??
    null

  const heading = device
    ? `${device.name} Cases`
    : caseTypeName
      ? `${caseTypeName} Cases`
      : "Shop"

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Shop</p>
        <h1 className="display text-[2.25rem] leading-tight md:text-[3rem]">
          {heading}
        </h1>
        <p className="text-sm text-ink-muted">
          {filtered.length} {filtered.length === 1 ? "product" : "products"}
          {device && caseTypeName ? ` · ${caseTypeName}` : ""}
          {truncated && !device ? ` of ${count}` : ""}
        </p>
      </header>

      {filtered.length ? (
        <div className="fl-grid">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              device={device?.name ?? null}
            />
          ))}
        </div>
      ) : (
        <div className="py-12">
          <p className="text-sm text-ink-muted">
            Nothing matches that combination
            {device ? ` for the ${device.name}` : ""}. Try another device or
            construction.
          </p>
          <Link
            href="/shop/"
            className="mt-4 inline-block text-sm underline underline-offset-4 transition-colors hover:text-purple"
          >
            Clear filters
          </Link>
        </div>
      )}
    </div>
  )
}
