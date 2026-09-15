import type { Metadata } from "next"
import Link from "next/link"

import ProductCard from "@/components/product-card"
import ShopSelectors from "@/components/shop-selectors"
import { getCaseTypes, getDeviceCatalog } from "@/lib/catalog"
import { listProducts, sdk, type StoreProduct } from "@/lib/medusa"

/**
 * The shop, rendered from clean path segments rather than query strings:
 *   /shop                       -> everything
 *   /shop/iphone-17-pro-max     -> one device
 *   /shop/iphone-17-pro-max/signature -> device + case type
 * Shared by app/shop/page.tsx (the bare landing, which also redirects the old
 * ?filter_device= links here) and app/shop/[...slug]/page.tsx.
 */

async function categoryFor(
  slug?: string
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
 * phones; AirPods / watch / wallet are their own products.
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

function pathFor(deviceSlug?: string, caseTypeSlug?: string): string {
  if (!deviceSlug) return "/shop/"
  return caseTypeSlug ? `/shop/${deviceSlug}/${caseTypeSlug}/` : `/shop/${deviceSlug}/`
}

export async function shopMetadata({
  deviceSlug,
  caseTypeSlug,
}: {
  deviceSlug?: string
  caseTypeSlug?: string
}): Promise<Metadata> {
  const devices = await getDeviceCatalog()
  const device = devices.find((d) => d.slug === deviceSlug)
  return {
    title: device ? `${device.name} Cases` : "Shop",
    alternates: { canonical: pathFor(device?.slug, caseTypeSlug) },
  }
}

export default async function ShopView({
  deviceSlug,
  caseTypeSlug,
}: {
  deviceSlug?: string
  caseTypeSlug?: string
}) {
  const [devices, caseTypes] = await Promise.all([
    getDeviceCatalog(),
    getCaseTypes(),
  ])
  const device = devices.find((d) => d.slug === deviceSlug) ?? null

  // Phones by default, or the family of the chosen device.
  const targetForm = device ? formForFamily(device.family) : "phone"

  const category = await categoryFor(caseTypeSlug)
  const { products, error } = await listProducts(
    category ? { category_id: [category.id], limit: 200 } : { limit: 200 }
  )

  const filtered: StoreProduct[] = products.filter(
    (p) =>
      (p.metadata?.form ?? "phone") === targetForm &&
      (!device || hasDevice(p, device.name))
  )

  // Which case types the current device is actually sold in - with a sample
  // render for each - so the case-type picker only offers real options (a case
  // type the model has no product for is hidden) and can show its image.
  const caseTypeByName = new Map(caseTypes.map((c) => [c.name, c]))
  const caseTypeImages: Record<string, string> = {}
  const availableSlugs = new Set<string>()
  if (device) {
    for (const p of filtered) {
      for (const v of p.variants ?? []) {
        const values = (v.options ?? []).map((o) => o.value)
        if (!values.includes(device.name)) continue
        const ctName = values.find((x) => x && caseTypeByName.has(x))
        if (!ctName) continue
        const ct = caseTypeByName.get(ctName)!
        availableSlugs.add(ct.slug)
        if (!caseTypeImages[ct.slug]) {
          const img = (v.metadata?.images as string[] | undefined)?.[0]
          if (img) caseTypeImages[ct.slug] = img
        }
      }
    }
  }
  const shownCaseTypes =
    device && availableSlugs.size
      ? caseTypes.filter((c) => availableSlugs.has(c.slug))
      : caseTypes

  const heading = device
    ? `${device.name} Cases`
    : category
      ? `${category.name} Cases`
      : "Shop"

  return (
    <div className="space-y-8">
      <header>
        {/* Kept for SEO / screen readers only - the selectors below show the
            same context (device + case type), so the big title block is hidden. */}
        <h1 className="sr-only">{heading}</h1>

        <ShopSelectors
          deviceSlug={device?.slug}
          caseTypeSlug={category ? caseTypeSlug : undefined}
          devices={devices}
          caseTypes={shownCaseTypes}
          caseTypeImages={caseTypeImages}
        />
      </header>

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
              caseType={category?.name ?? null}
              caseTypeSlug={category ? (caseTypeSlug ?? null) : null}
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
