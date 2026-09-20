import type { Metadata } from "next"
import Link from "next/link"

import ShopGrid from "@/components/shop-grid"
import ShopSelectors from "@/components/shop-selectors"
import {
  getCaseTypes,
  getDeviceCatalog,
  getShopCatalog,
  getShopCards,
  shopCardImage,
  type CaseTypeRecord,
  type DeviceRecord,
  type ShopDesign,
  type ShopCard,
} from "@/lib/catalog"
import { listProducts, type StoreProduct, type StoreVariant } from "@/lib/medusa"

/** Designs per page. A full grid is 4 across, so this is 8 rows on desktop. */
const PAGE_SIZE = 32

/**
 * The shop, rendered from a light design catalogue rather than the full product
 * list. Pulling every variant's calculated_price for ~180 designs took ~40s once
 * the whole library went live; instead the grid pages through the catalogue
 * (design + case types, no variants), prices each card from the fixed case-type
 * price, and fetches variant IDs and stored card images for only the current
 * page (so Quick Add still works) - no per-variant price calculation.
 *
 * Routes (path-based paging so each page is its own ISR entry):
 *   /shop                                   -> everything (page 1)
 *   /shop/iphone-17-pro-max                 -> one device
 *   /shop/iphone-17-pro-max/signature       -> device + case type
 *   /shop/iphone-17-pro-max/signature/2     -> page 2 of that
 */

function formForFamily(family: string): string {
  return family === "iphone" || family === "samsung" ? "phone" : family
}

function pathFor(
  deviceSlug?: string,
  caseTypeSlug?: string,
  page?: number
): string {
  const base = !deviceSlug
    ? "/shop/"
    : caseTypeSlug
      ? `/shop/${deviceSlug}/${caseTypeSlug}/`
      : `/shop/${deviceSlug}/`
  return page && page > 1 ? `${base}${page}/` : base
}

/** The product handle for a design in a given form: the slug, or slug-<form>. */
function handleFor(slug: string, form: string): string {
  return form === "phone" ? slug : `${slug}-${form}`
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
  page = 1,
}: {
  deviceSlug?: string
  caseTypeSlug?: string
  page?: number
}) {
  const [devices, caseTypes, catalog] = await Promise.all([
    getDeviceCatalog(),
    getCaseTypes(),
    getShopCatalog(deviceSlug),
  ])

  const device = devices.find((d) => d.slug === deviceSlug) ?? null
  const targetForm = device ? formForFamily(device.family) : "phone"

  // The case type in view: the chosen one, else the first that the catalogue
  // actually uses (so a bare /shop still shows real cards and prices).
  const usedCaseSlugs = new Set<string>()
  for (const d of catalog) for (const c of d.caseTypes) usedCaseSlugs.add(c)
  const shownCaseTypes = caseTypes.filter((c) => usedCaseSlugs.has(c.slug))
  const caseType: CaseTypeRecord | null =
    (caseTypeSlug && caseTypes.find((c) => c.slug === caseTypeSlug)) ||
    shownCaseTypes[0] ||
    caseTypes[0] ||
    null
  const caseSlug = caseType?.slug ?? ""

  // Designs that are sold in this form and (if one is chosen) this case type.
  const matching = catalog.filter(
    (d) => d.forms.includes(targetForm) && (!caseSlug || d.caseTypes.includes(caseSlug))
  )

  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const current = Math.min(Math.max(page, 1), totalPages)
  const pageDesigns = matching.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE
  )

  // Variant id per card, so Quick Add keeps working - fetched for THIS page only
  // (32 products), and without calculated_price. Falls back to no-add if the
  // lookup is slow or missing; the card still links to the product page.
  const variantByHandle = new Map<string, string>()
  const cardsByHandle = new Map<string, ShopCard>()
  if (device && pageDesigns.length) {
    const handles = pageDesigns.map((d) => handleFor(d.slug, targetForm))
    const cards = await getShopCards(handles, device.name, caseType?.name ?? "")
    for (const card of cards ?? []) {
      cardsByHandle.set(card.handle, card)
      if (card.variantId) variantByHandle.set(card.handle, card.variantId)
    }
    // Legacy products without card metadata and rolling backend deployments
    // retain their old ID lookup. Do not fetch all-model metadata or galleries.
    const missing = handles.filter((handle) => !variantByHandle.has(handle))
    if (missing.length) {
      const { products } = await listProducts({
        handle: missing,
        limit: PAGE_SIZE,
        fields: "id,handle,variants.id,variants.options.value",
      }, { pricing: false })
      for (const p of products) {
        const v = (p.variants ?? []).find((vv) => {
          const vals = (vv.options ?? []).map((o) => o.value)
          return vals.includes(device.name) && vals.includes(caseType?.name ?? "")
        })
        if (v?.id) variantByHandle.set(p.handle!, v.id)
      }
    }
  }

  // Reuse this page's stored renders when available; other picker samples keep
  // the legacy path without fetching another page's products.
  const caseTypeImages: Record<string, string> = {}
  if (device) {
    for (const ct of shownCaseTypes) {
      const sample = catalog.find(
        (d) => d.forms.includes(targetForm) && d.caseTypes.includes(ct.slug)
      )
      if (sample) {
        caseTypeImages[ct.slug] = cardsByHandle.get(handleFor(sample.slug, targetForm))?.imagesByCaseType?.[ct.name] ??
          shopCardImage(sample.slug, ct.slug, device.slug)
      }
    }
  }

  // Build a light, ProductCard-shaped object per card: one variant carrying the
  // stored image and the fixed case-type price, so ProductCard renders it
  // unchanged (it scopes to the device+case-type variant and reads that image
  // and price).
  const price = caseType?.price ?? 0
  const products: StoreProduct[] = pageDesigns.map((d) => {
    const handle = handleFor(d.slug, targetForm)
    const image = device
      ? cardsByHandle.get(handle)?.image ??
        shopCardImage(d.slug, caseSlug, device.slug)
      : null
    const variant = {
      // Empty when the id lookup missed, so QuickAdd hides rather than trying to
      // add a non-existent variant; the card still links to the product page.
      id: variantByHandle.get(handle) ?? "",
      title: caseType?.name ?? "",
      options: [
        { value: device?.name ?? "" },
        { value: caseType?.name ?? "" },
      ],
      calculated_price: { calculated_amount: price },
      metadata: { images: image ? [image] : [] },
    } as unknown as StoreVariant
    return {
      id: `card-${d.slug}`,
      title: d.name,
      handle,
      thumbnail: image,
      metadata: { design_name: d.name, design_slug: d.slug, form: targetForm },
      variants: [variant],
    } as unknown as StoreProduct
  })

  const heading = device
    ? `${device.name} Cases`
    : caseType
      ? `${caseType.name} Cases`
      : "Shop"

  return (
    <div className="space-y-8">
      <header>
        <h1 className="sr-only">{heading}</h1>

        <ShopSelectors
          deviceSlug={device?.slug}
          caseTypeSlug={caseType ? caseSlug : undefined}
          devices={devices}
          caseTypes={shownCaseTypes}
          caseTypeImages={caseTypeImages}
        />
      </header>

      {matching.length ? (
        <ShopGrid
          products={products}
          device={device?.name ?? null}
          deviceSlug={device?.slug ?? null}
          caseType={caseType?.name ?? null}
          caseTypeSlug={caseType ? caseSlug : null}
          totalCount={matching.length}
          currentPage={current}
          totalPages={totalPages}
        />
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

// Kept exported for callers that import the record types from here.
export type { DeviceRecord, ShopDesign }
