import type { Metadata } from "next"
import { unstable_cache } from "next/cache"
import { notFound } from "next/navigation"
import { cache } from "react"

import CollectionFilters from "@/components/collection-filters"
import CollectionHero from "@/components/collection-hero"
import ProductCard from "@/components/product-card"
import { getDeviceCatalog } from "@/lib/catalog"
import { COLLECTION_FIELDS, hydrateCollectionProducts } from "@/lib/collection-products"
import { getCollectionPage } from "@/lib/content"
import { listProducts, sdk, type StoreProduct } from "@/lib/medusa"
import { buildVariantMatrix } from "@/lib/variant-matrix"

type Params = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Matches the live site, which opens its collection pages on this device. */
const DEFAULT_DEVICE = "iPhone 17 Pro Max"

/** Families that come in more than one construction. */
const MULTI_CASE_TYPE_FAMILIES = new Set(["iphone", "samsung"])

/**
 * /collection/<slug>/ serves two kinds of grouping:
 *
 *   - a Medusa collection, used for themes (Abstract, Floral, ...)
 *   - a Medusa category, used for the structural taxonomy (case types and
 *     device families), which a product can belong to more than one of
 *
 * Collections are checked first so a curated collection can shadow a category
 * of the same handle.
 */
const getCollectionGroup = unstable_cache(
  async (slug: string) => {
    const { collections } = await sdk.store.collection.list({
      handle: slug,
      limit: 1,
    })
    if (collections?.length) {
      return {
        kind: "collection" as const,
        id: collections[0].id,
        title: collections[0].title,
        description: null as string | null,
      }
    }
    const { product_categories } = await sdk.store.category.list({
      handle: slug,
      limit: 1,
    })
    if (product_categories?.length) {
      const category = product_categories[0]
      return {
        kind: "category" as const,
        id: category.id,
        title: category.name,
        description: category.description ?? null,
      }
    }
    return null
  },
  ["collection-group-v1"],
  { revalidate: 300, tags: ["products"] }
)

// Metadata and the body share one lookup. Backend failures escape the persistent
// cache, then retain the existing not-found fallback for this request only.
const resolveCollection = cache(async (slug: string) => {
  try {
    return await getCollectionGroup(slug)
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const group = await resolveCollection(slug)

  // Same soft-404 as the product route: loading.tsx commits the 200 before
  // the body runs, so the check has to happen here.
  if (!group) {
    notFound()
  }

  return {
    title: group.title,
    description: group.description ?? undefined,
    alternates: { canonical: `/collection/${slug}/` },
  }
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

export default async function CollectionPage({ params, searchParams }: Params) {
  const { slug } = await params
  const query = await searchParams
  const group = await resolveCollection(slug)

  if (!group) {
    notFound()
  }

  const [{ products }, deviceCatalog, landing] = await Promise.all([
    listProducts({
      ...(group.kind === "collection"
        ? { collection_id: group.id }
        : { category_id: group.id }),
      limit: 100,
      fields: COLLECTION_FIELDS,
    }),
    getDeviceCatalog(),
    getCollectionPage(slug),
  ])

  /*
   * Structure B: a design is one phone-case product (plus separate AirPods etc.
   * products). A collection is browsed as phone cases, so keep the phone form -
   * that already yields one card per design. Device and Case Type both come from
   * the products' own option matrix.
   */
  const phoneProducts = products.filter(
    (p) => (p.metadata?.form ?? "phone") === "phone"
  )
  const matrices = new Map(phoneProducts.map((p) => [p.id, buildVariantMatrix(p)]))

  // Only offer devices this collection actually has stock for.
  const availableDeviceNames = new Set<string>(
    phoneProducts.flatMap((p) => matrices.get(p.id)!.devices)
  )
  const deviceOptions = deviceCatalog
    .filter((d) => availableDeviceNames.has(d.name))
    .map((d) => ({ value: d.name, label: d.name }))

  const requestedDevice = first(query.device)
  const device =
    deviceOptions.find((o) => o.value === requestedDevice)?.value ??
    deviceOptions.find((o) => o.value === DEFAULT_DEVICE)?.value ??
    deviceOptions[0]?.value ??
    ""
  const deviceSlug = deviceCatalog.find((d) => d.name === device)?.slug ?? null

  const deviceFamily = deviceCatalog.find((d) => d.name === device)?.family
  const showCaseType = MULTI_CASE_TYPE_FAMILIES.has(deviceFamily ?? "")

  // Products offered for the chosen device, and the case types available on it.
  const forDevice = device
    ? phoneProducts.filter((p) => matrices.get(p.id)!.devices.includes(device))
    : phoneProducts

  const caseTypesForDevice = (p: StoreProduct): string[] => {
    const m = matrices.get(p.id)!
    return device ? (m.caseTypesByDevice[device] ?? []) : m.caseTypes
  }
  const caseTypeOptions = [
    ...new Set(forDevice.flatMap((p) => caseTypesForDevice(p))),
  ].map((ct) => ({ value: ct, label: ct }))

  const caseType = showCaseType ? first(query.case_type) : ""
  const filtered = caseType
    ? forDevice.filter((p) => caseTypesForDevice(p).includes(caseType))
    : forDevice

  const sort = first(query.sort) || "featured"
  const priced = await hydrateCollectionProducts(filtered, device)
  let sorted = sortProducts(priced.products, sort)

  /*
   * A curated design list wins over the default ordering, but only while the
   * shopper has not asked for a different sort - their choice should not be
   * silently overridden.
   */
  const curated = landing?.design_slugs ?? []
  if (curated.length && sort === "featured") {
    const rank = new Map(curated.map((designSlug, i) => [designSlug, i]))
    sorted = sorted
      .filter((product) => rank.has(product.metadata?.design_slug as string))
      .sort(
        (a, b) =>
          (rank.get(a.metadata?.design_slug as string) ?? 0) -
          (rank.get(b.metadata?.design_slug as string) ?? 0)
      )
  }

  const resultLabel = device
    ? `${device} Cases - ${sorted.length}`
    : `${sorted.length} ${sorted.length === 1 ? "product" : "products"}`

  return (
    <div className="space-y-8">
      {landing ? (
        <CollectionHero
          page={landing}
          fallbackImage={sorted[0]?.thumbnail ?? products[0]?.thumbnail ?? null}
          title={group.title}
        />
      ) : (
        <header className="space-y-3">
          <p className="eyebrow">Collection</p>
          <h1 className="display text-[2.25rem] leading-tight md:text-[3rem]">
            {group.title}
          </h1>
          {group.description ? (
            <p className="max-w-2xl text-ink-muted">{group.description}</p>
          ) : null}
        </header>
      )}

      <CollectionFilters
        devices={deviceOptions}
        caseTypes={caseTypeOptions}
        device={device}
        caseType={caseType}
        sort={sort}
        showCaseType={showCaseType}
        resultLabel={resultLabel}
      />

      {sorted.length ? (
        <div className="fl-grid">
          {sorted.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              device={device || null}
              deviceSlug={deviceSlug}
            />
          ))}
        </div>
      ) : (
        <p className="py-10 text-sm text-ink-muted">
          Nothing here fits that combination. Try another device or case type.
        </p>
      )}
    </div>
  )
}

function sortProducts(products: StoreProduct[], sort: string): StoreProduct[] {
  const priceOf = (p: StoreProduct) =>
    p.variants?.[0]?.calculated_price?.calculated_amount ?? 0
  const nameOf = (p: StoreProduct) =>
    ((p.metadata?.design_name as string) ?? p.title).toLowerCase()

  const copy = [...products]
  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => priceOf(a) - priceOf(b))
    case "price-desc":
      return copy.sort((a, b) => priceOf(b) - priceOf(a))
    case "name":
      return copy.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    default:
      return copy
  }
}
