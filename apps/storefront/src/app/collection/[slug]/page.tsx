import type { Metadata } from "next"
import { notFound } from "next/navigation"

import CollectionFilters from "@/components/collection-filters"
import ProductCard from "@/components/product-card"
import { getDeviceCatalog } from "@/lib/catalog"
import { listProducts, sdk, type StoreProduct } from "@/lib/medusa"

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
async function resolveCollection(slug: string) {
  try {
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
  } catch {
    // Fall through to categories.
  }

  try {
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
  } catch {
    // Nothing matched.
  }

  return null
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const group = await resolveCollection(slug)

  if (!group) {
    return { title: "Not found" }
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

  const [{ products }, deviceCatalog] = await Promise.all([
    listProducts(
      group.kind === "collection"
        ? { collection_id: group.id, limit: 100 }
        : { category_id: group.id, limit: 100 }
    ),
    getDeviceCatalog(),
  ])

  // Only offer devices this collection actually has stock for.
  const availableDeviceNames = new Set<string>()
  for (const product of products) {
    for (const variant of product.variants ?? []) {
      availableDeviceNames.add(variant.title)
    }
  }

  const deviceOptions = deviceCatalog
    .filter((d) => availableDeviceNames.has(d.name))
    .map((d) => ({ value: d.name, label: d.name }))

  const requestedDevice = first(query.device)
  const device =
    deviceOptions.find((o) => o.value === requestedDevice)?.value ??
    deviceOptions.find((o) => o.value === DEFAULT_DEVICE)?.value ??
    deviceOptions[0]?.value ??
    ""

  const deviceFamily = deviceCatalog.find((d) => d.name === device)?.family
  const showCaseType = MULTI_CASE_TYPE_FAMILIES.has(deviceFamily ?? "")

  // Case types present among the products that fit the chosen device.
  const forDevice = device
    ? products.filter((p) => (p.variants ?? []).some((v) => v.title === device))
    : products

  const caseTypeOptions = [
    ...new Map(
      forDevice
        .map((p) => [
          p.metadata?.case_type_slug as string | undefined,
          p.metadata?.case_type_name as string | undefined,
        ])
        .filter(([value, label]) => value && label)
        .map(([value, label]) => [value!, { value: value!, label: label! }])
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label))

  const caseType = showCaseType ? first(query.case_type) : ""
  const filtered = caseType
    ? forDevice.filter((p) => p.metadata?.case_type_slug === caseType)
    : forDevice

  const sort = first(query.sort) || "featured"
  const sorted = sortProducts(filtered, sort)

  const resultLabel = device
    ? `${device} Cases - ${sorted.length}`
    : `${sorted.length} ${sorted.length === 1 ? "product" : "products"}`

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Collection</p>
        <h1 className="display text-[2.25rem] leading-tight md:text-[3rem]">
          {group.title}
        </h1>
        {group.description ? (
          <p className="max-w-2xl text-ink-muted">{group.description}</p>
        ) : null}
      </header>

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
