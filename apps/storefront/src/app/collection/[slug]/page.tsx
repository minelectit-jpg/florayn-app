import type { Metadata } from "next"
import { unstable_cache } from "next/cache"
import { notFound } from "next/navigation"
import { cache } from "react"

import CollectionBlocks from "@/components/collection-blocks"
import CollectionFilters from "@/components/collection-filters"
import CollectionHero from "@/components/collection-hero"
import CollectionShell from "@/components/collection-shell"
import ProductCard from "@/components/product-card"
import { getDeviceCatalog } from "@/lib/catalog"
import { COLLECTION_FIELDS, hydrateCollectionProducts } from "@/lib/collection-products"
import { getCollectionPage } from "@/lib/content"
import { listProducts, sdk, type StoreProduct } from "@/lib/medusa"
import { formForDeviceFamily, productTypeLabel } from "@/lib/product-forms"
import { buildVariantMatrix } from "@/lib/variant-matrix"

type Params = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Matches the live site, which opens its collection pages on these devices. */
const DEFAULT_DEVICE: Record<string, string> = {
  phone: "iPhone 17 Pro Max",
  airpods: "AirPods Pro 3",
}

/** Product-type tabs, in this order, then anything newer alphabetically. */
const FORM_ORDER = ["phone", "airpods", "watch", "wallet"]
const FORM_LABELS: Record<string, string> = {
  phone: "Phone Cases",
  airpods: "AirPods Cases",
  watch: "Watch Bands",
  wallet: "Wallets",
}
const formOf = (p: StoreProduct) => (p.metadata?.form as string | undefined) ?? "phone"

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
  const devicesPromise = getDeviceCatalog()
  const landingPromise = getCollectionPage(slug)
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
    }, { pricing: false }),
    devicesPromise,
    landingPromise,
  ])

  /*
   * Structure B: a design is one product per form - a phone case, an AirPods
   * case, a watch band... A collection is browsed one form at a time (phone
   * cases first), which yields one card per design. Device and Case Type both
   * come from the products' own option matrix.
   */
  const forms = [...new Set(products.map(formOf))].sort((a, b) => {
    const ia = FORM_ORDER.indexOf(a)
    const ib = FORM_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  const requestedDevice = first(query.device)
  const requestedForm = first(query.form)
  const requestedFamily = deviceCatalog.find((d) => d.name === requestedDevice)?.family
  const deviceForm = requestedFamily ? formForDeviceFamily(requestedFamily) : ""
  const form = forms.includes(requestedForm)
    ? requestedForm
    : forms.includes(deviceForm)
      ? deviceForm
      : forms.includes("phone")
        ? "phone"
        : (forms[0] ?? "phone")

  const formProducts = products.filter((p) => formOf(p) === form)
  const matrices = new Map(formProducts.map((p) => [p.id, buildVariantMatrix(p)]))

  // Only offer devices this collection actually has stock for, in this form's
  // family (iPhone and Samsung share phone; AirPods never mix in).
  const availableDeviceNames = new Set<string>(
    formProducts.flatMap((p) => matrices.get(p.id)!.devices)
  )
  const available = deviceCatalog.filter((d) => availableDeviceNames.has(d.name))
  const sameFamily = available.filter((d) => formForDeviceFamily(d.family ?? "") === form)
  const deviceOptions = (sameFamily.length ? sameFamily : available)
    .map((d) => ({ value: d.name, label: d.name }))

  const device =
    deviceOptions.find((o) => o.value === requestedDevice)?.value ??
    deviceOptions.find((o) => o.value === DEFAULT_DEVICE[form])?.value ??
    deviceOptions[0]?.value ??
    ""
  const deviceSlug = deviceCatalog.find((d) => d.name === device)?.slug ?? null

  const deviceFamily = deviceCatalog.find((d) => d.name === device)?.family
  const showCaseType = MULTI_CASE_TYPE_FAMILIES.has(deviceFamily ?? "")

  // Products offered for the chosen device, and the case types available on it.
  const forDevice = device
    ? formProducts.filter((p) => matrices.get(p.id)!.devices.includes(device))
    : formProducts

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
  /*
   * A curated design list wins over the default ordering, but only while the
   * shopper has not asked for a different sort - their choice should not be
   * silently overridden.
   */
  const curated = landing?.design_slugs ?? []
  const rank = curated.length && sort === "featured"
    ? new Map(curated.map((designSlug, i) => [designSlug, i]))
    : null
  // Device/case options still describe the whole collection. Price only cards
  // that survive the same curated membership filter used for rendering.
  const visible = rank
    ? filtered.filter((product) => rank.has(product.metadata?.design_slug as string))
    : filtered
  const priced = await hydrateCollectionProducts(visible, device, {
    includeFirstVariant: sort === "price-asc" || sort === "price-desc",
  })
  let sorted = sortProducts(priced.products, sort)
  if (rank) {
    sorted = sorted.sort(
      (a, b) =>
        (rank.get(a.metadata?.design_slug as string) ?? 0) -
        (rank.get(b.metadata?.design_slug as string) ?? 0)
    )
  }

  const resultLabel = device
    ? `${device} Cases - ${sorted.length}`
    : `${sorted.length} ${sorted.length === 1 ? "product" : "products"}`

  // The hero falls back to a phone render even while AirPods are showing.
  const artwork =
    products.find((p) => formOf(p) === "phone" && p.thumbnail)?.thumbnail ??
    sorted[0]?.thumbnail ??
    products[0]?.thumbnail ??
    null

  return (
    <CollectionShell theme={landing?.theme ?? null}>
      {landing ? (
        <CollectionHero page={landing} fallbackImage={artwork} title={group.title} />
      ) : (
        <header className="fl-cplain">
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
        forms={forms.map((f) => ({ value: f, label: FORM_LABELS[f] ?? productTypeLabel(f) }))}
        form={form}
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

      {landing?.blocks?.length ? <CollectionBlocks blocks={landing.blocks} /> : null}
    </CollectionShell>
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
