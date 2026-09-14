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

async function categoryFor(
  slug: string
): Promise<{ id: string; name: string } | null> {
  if (!slug) return null
  try {
    const { product_categories } = await sdk.store.category.list({
      handle: slug,
      limit: 1,
    })
    const c = product_categories?.[0]
    return c ? { id: c.id, name: c.name } : null
  } catch {
    return null
  }
}

/**
 * Which product FORM a device belongs to. A phone case product lists only
 * phones; AirPods / watch / wallet are their own products, so browsing an
 * AirPods device shows AirPods-case products, never phone cases.
 */
function formForFamily(family: string): string {
  return family === "iphone" || family === "samsung" ? "phone" : family
}

/** Whether a product is sold for a device (matched on the Device option). */
function hasDevice(product: StoreProduct, deviceName: string): boolean {
  return (product.variants ?? []).some((v) =>
    (v.options ?? []).some((o) => o.value === deviceName)
  )
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

  // Which product form this page is about: phones by default, or the family of
  // the chosen device (AirPods / watch / wallet browse their own products).
  const targetForm = device ? formForFamily(device.family) : "phone"

  /*
   * Narrow by case type first (a category) to keep the query small; the limit
   * clears the largest case type (Signature) because the form/device filters
   * run over what comes back. Structure B gives one product per design PER
   * FORM, so filtering to the target form yields one card per design.
   */
  const category = await categoryFor(caseTypeSlug)
  const { products, count, error } = await listProducts(
    category ? { category_id: [category.id], limit: 200 } : { limit: 200 }
  )
  const truncated = count > products.length

  const filtered: StoreProduct[] = products.filter(
    (p) =>
      (p.metadata?.form ?? "phone") === targetForm &&
      (!device || hasDevice(p, device.name))
  )

  const heading = device
    ? `${device.name} Cases`
    : category
      ? `${category.name} Cases`
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
            {device && category ? ` · ${category.name}` : ""}
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
              deviceSlug={device?.slug ?? null}
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
