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
  const { products, count, error } = await listProducts(
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
        {error ? null : (
          <p className="text-sm text-ink-muted">
            {filtered.length} {filtered.length === 1 ? "product" : "products"}
            {device && caseTypeName ? ` · ${caseTypeName}` : ""}
            {truncated && !device ? ` of ${count}` : ""}
          </p>
        )}
      </header>

      {/*
        A read failure is not an empty catalogue, and must not be dressed as
        one. "0 products" against a full database is what sent the last
        investigation to the wrong place entirely.
      */}
      {error ? (
        <div className="rounded-[12px] border border-line bg-surface p-6">
          <p className="text-sm font-semibold">The catalogue could not be loaded.</p>
          <p className="mt-2 text-sm text-ink-muted">
            This is a connection problem, not an empty shop. Please try again
            shortly.
          </p>
        </div>
      ) : filtered.length ? (
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
