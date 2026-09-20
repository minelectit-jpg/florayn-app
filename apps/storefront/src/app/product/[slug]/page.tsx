import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ProductView from "@/components/product-view"
import {
  type RecommendedItem,
  type RecommendedVariant,
} from "@/components/recommended-for-you"
import {
  PairsWellWith,
  ShippingNote,
  type RelatedProduct,
} from "@/components/product-sections"
import ProductTabs from "@/components/product-tabs"
import { getBundleConfig } from "@/lib/bundles"
import {
  getBlankStock,
  getCaseTypes,
  getDeviceCatalog,
  getDeviceFamilyMap,
} from "@/lib/catalog"
import { getGalleryVideos, getProductSections } from "@/lib/content"
import { resolveProductPage } from "@/lib/device-page"
import {
  applyCaseTypePrices,
  listProducts,
  POOL_FIELDS,
  type StoreProduct,
} from "@/lib/medusa"
import { fitCopy, getSeoConfig, resolveSeo } from "@/lib/seo-copy"
import { buildVariantMatrix } from "@/lib/variant-matrix"
import { buildSimpleMatrix, productViewDesigns, productViewMatrix, productViewVariants } from "@/lib/product-view-data"

type Params = {
  params: Promise<{ slug: string }>
}

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
 * kept light (see the sibling-designs fetch below), so the first visit is quick.
 */
export async function generateStaticParams() {
  return [] as { slug: string }[]
}

/** Cheapest variant of a product, for a card's "From" price. */
function minPrice(product: StoreProduct): number | null {
  const amounts = (product.variants ?? [])
    .map((v) => v.calculated_price?.calculated_amount)
    .filter((a): a is number => typeof a === "number")
  return amounts.length ? Math.min(...amounts) : null
}

type CardPair = { variantId: string; price?: number | null; image?: string | null }
type ProductCardMeta = { pairs?: Record<string, CardPair> }

/**
 * Rebuild the minimal variant shape the below-the-fold strips iterate, from a
 * pool product's precomputed metadata.card, so the pool query never hydrates the
 * ~102 real variants (POOL_FIELDS drops *variants). Each synthesized variant
 * carries exactly what the strip builders read: id, the Case Type + Device
 * options (so applyCaseTypePrices can price it and the builders can key by
 * "device|caseType"), a title, and the variant image. Price is left to
 * applyCaseTypePrices (the fixed case-type map), identical to the old path.
 */
function hydratePoolVariantsFromCard(p: StoreProduct): void {
  const card = (p.metadata as Record<string, unknown> | null | undefined)
    ?.card as ProductCardMeta | undefined
  if (!card?.pairs) {
    if (!p.variants) p.variants = []
    return
  }
  const optId = (title: string) =>
    p.options?.find((o) => o.title.toLowerCase() === title)?.id
  const deviceOptId = optId("device")
  const caseOptId = optId("case type")
  const variants = Object.entries(card.pairs).map(([key, v]) => {
    const [dev, ct] = key.split("|")
    return {
      id: v.variantId,
      title: `${ct} / ${dev}`,
      options: [
        ...(deviceOptId ? [{ option_id: deviceOptId, value: dev }] : []),
        ...(caseOptId ? [{ option_id: caseOptId, value: ct }] : []),
      ],
      metadata: { images: v.image ? [v.image] : [] },
    }
  })
  ;(p as unknown as { variants: unknown }).variants = variants
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const resolved = await resolveProductPage(slug)
  if (!resolved) notFound()

  const { product, device } = resolved
  const design = (product.metadata?.design_name as string) ?? product.title
  const canonical = `/product/${slug}/`

  if (!device) {
    return {
      title: product.title,
      description: product.description?.slice(0, 160) ?? undefined,
      alternates: { canonical },
    }
  }

  const seo = resolveSeo({
    config: await getSeoConfig(),
    designSlug: product.metadata?.design_slug as string | undefined,
    deviceSlug: device.slug,
    values: { design, device: device.name, caseType: "" },
  })

  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical },
    openGraph: {
      title: seo.title,
      description: seo.description,
      images: product.thumbnail ? [product.thumbnail] : undefined,
    },
  }
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params
  const productPromise = resolveProductPage(slug).then((resolved) => resolved
    ? { ...resolved, matrix: buildVariantMatrix(resolved.product) }
    : null)
  const sectionsPromise = getProductSections()

  // Start each dependency as soon as its inputs are available. A slow stock or
  // SEO request must not postpone collection data or the featured-picks query.
  const relatedPromise = productPromise.then(async (resolved) => {
    if (!resolved?.matrix.caseTypes.length || !resolved.matrix.devices.length) {
      return [{ products: [] as StoreProduct[] }, {}] as const
    }
    const collectionId = resolved?.product.collection?.id
    const designSlug = resolved?.product.metadata?.design_slug as string | undefined
    return Promise.all([
      collectionId
        ? listProducts({ collection_id: [collectionId], limit: 100, fields: POOL_FIELDS }, { pricing: false })
        : Promise.resolve({ products: [] as StoreProduct[] }),
      getGalleryVideos(designSlug ?? ""),
    ])
  })
  const picksPromise = Promise.all([sectionsPromise, productPromise]).then(async ([{ featuredPicks }, resolved]) => {
    if (!featuredPicks.length || !resolved?.matrix.caseTypes.length || !resolved.matrix.devices.length) return [] as StoreProduct[]
    const { products } = await listProducts({
      handle: featuredPicks,
      limit: featuredPicks.length,
      fields: POOL_FIELDS,
    }, { pricing: false })
    const byHandle = new Map(products.map((p) => [p.handle, p]))
    return featuredPicks
      .map((handle) => byHandle.get(handle))
      .filter((p): p is StoreProduct => Boolean(p))
  })
  const [
    resolved,
    families,
    deviceCatalog,
    stock,
    caseTypes,
    bundleConfig,
    productSections,
    seoConfig,
  ] = await Promise.all([
    productPromise,
    getDeviceFamilyMap(),
    getDeviceCatalog(),
    getBlankStock(),
    getCaseTypes(),
    getBundleConfig(),
    sectionsPromise,
    productPromise.then((resolved) => resolved?.device ? getSeoConfig() : null),
  ])
  if (!resolved) notFound()
  const { product, device, matrix } = resolved
  const designSlug = product.metadata?.design_slug as string | undefined
  const designName = (product.metadata?.design_name as string) ?? product.title
  const { featureBlocks } = productSections

  // Apply the existing fixed prices for supported case types. Variants such as
  // Alcantara retain the region-calculated prices fetched with the product.
  const priceByCaseType = new Map(caseTypes.map((c) => [c.name, c.price]))
  applyCaseTypePrices(product, priceByCaseType)

  // A non-case product (a StickPad, a one-off accessory) renders through the
  // SAME ProductView, so the store has ONE product-page type. Its single option's
  // values become the tiles (e.g. colours) - no device selector, no multi-buy
  // packs - and the Features band still keys off the form ("Sticky Pad").
  if (!(matrix.caseTypes.length && matrix.devices.length)) {
    const simple = buildSimpleMatrix(product)
    const simpleFacts = [
      ...(product.collection
        ? [{ label: "Collection", value: product.collection.title }]
        : []),
      { label: "Product", value: designName },
      ...(simple.optionTitle && simple.values.length > 1
        ? [{ label: simple.optionTitle, value: simple.values.join(", ") }]
        : []),
    ]
    return (
      <article className="mx-auto w-full max-w-[1360px] px-0 md:px-[30px]">
        <ProductView
          pagePath={`/product/${slug}/`}
          matrix={simple.matrix}
          variants={productViewVariants(product.variants ?? [])}
          families={families}
          stock={stock}
          fallbackImages={(product.images ?? []).map((i) => i.url)}
          designName={designName}
          productHandle={product.handle}
          productTitle={product.title}
          collection={
            product.collection
              ? { title: product.collection.title, handle: product.collection.handle }
              : null
          }
          deviceName={null}
          initialCaseType={simple.values[0] ?? ""}
          initialDevice=""
          designData={productViewDesigns([], [])}
          bundleConfig={null}
          caseTypeRecords={[]}
          bundleAirpods={null}
          shipping={<ShippingNote />}
          tabs={
            <ProductTabs
              description={product.description}
              caseTypeName={null}
              caseTypeDescription={product.description}
              facts={simpleFacts}
              designName={designName}
            />
          }
          pairs={null}
          recommendedItems={[]}
          featureBlocks={featureBlocks}
          productForm={(product.metadata?.form as string) ?? null}
          simple
          optionLabel={simple.optionTitle ?? undefined}
        />
      </article>
    )
  }

  const [[poolResult, galleryVideos], pickedProducts] = await Promise.all([
    relatedPromise,
    picksPromise,
  ])

  /*
   * The base page's default device: the NEWEST flagship phone (iPhone first,
   * then Samsung), preferring one that every case type is sold for so all the
   * Case Type tiles are enabled on first load. This keeps the opening view
   * modern and consistent; a device page opens on its own device instead.
   */
  const familyByName: Record<string, string> = {}
  const orderByName: Record<string, number> = {}
  deviceCatalog.forEach((d, i) => {
    familyByName[d.name] = d.family
    orderByName[d.name] = i
  })

  // Phones only, iPhone before Samsung, newest first within each.
  const phonesNewestFirst = matrix.devices
    .filter(
      (d) => familyByName[d] === "iphone" || familyByName[d] === "samsung"
    )
    .sort((a, b) => {
      const rank = (n: string) => (familyByName[n] === "iphone" ? 0 : 1)
      return rank(a) - rank(b) || (orderByName[b] ?? 0) - (orderByName[a] ?? 0)
    })
  const inEveryCaseType = (d: string) =>
    (matrix.caseTypesByDevice[d] ?? []).length === matrix.caseTypes.length
  const defaultDevice =
    phonesNewestFirst.find(inEveryCaseType) ??
    phonesNewestFirst[0] ??
    matrix.devices[0]

  const initialDevice =
    device && matrix.devices.includes(device.name) ? device.name : defaultDevice

  // The device's first construction. A ?case=<slug> from a filtered shop card
  // is honoured on the client (ProductView reads it after hydration), which
  // keeps this page static/cacheable.
  const initialCaseType =
    (matrix.caseTypesByDevice[initialDevice] ?? matrix.caseTypes)[0] ??
    matrix.caseTypes[0]

  // Fit sentence, generated from the device's own attributes (device pages only).
  let deviceCopy: string | null = null
  if (device && seoConfig) {
    const seo = resolveSeo({
      config: seoConfig,
      designSlug,
      deviceSlug: device.slug,
      values: { design: designName, device: device.name, caseType: "" },
    })
    deviceCopy = seo.fitCopyEnabled
      ? (seo.fitCopyOverride ?? fitCopy(device.name, device.slug))
      : null
  }

  // The collection query was started alongside the independent page data.
  const { products: pool } = poolResult
  // Rebuild each pool product's variants from its precomputed metadata.card
  // (POOL_FIELDS no longer hydrates real variants). Then price them exactly as
  // before from the fixed case-type map.
  for (const p of pool) hydratePoolVariantsFromCard(p)
  // Alcantara is per-device priced, so its variants keep no price here and fall
  // out of the strips' "from" price and the add paths below (guarded), rather
  // than showing ৳0 - an accepted trade for the handful of Alcantara designs.
  for (const p of pool) applyCaseTypePrices(p, priceByCaseType)

  const otherPhoneDesigns = pool.filter(
    (p) =>
      p.metadata?.form === "phone" && p.metadata?.design_slug !== designSlug
  )

  // Picks also carry a precomputed card. Keep their existing pricing, then
  // share each design's choices across the strips and the pack picker.
  for (const p of pickedProducts) hydratePoolVariantsFromCard(p)
  for (const p of pickedProducts) applyCaseTypePrices(p, priceByCaseType)
  const designData = productViewDesigns(otherPhoneDesigns, pickedProducts)

  // MATCHING SET (bundle): this design's AirPods case, its variants keyed by
  // AirPods model, so the bundle panel can offer the model and price it.
  const airpodsProduct = pool.find(
    (p) =>
      p.metadata?.design_slug === designSlug &&
      p.metadata?.form === "airpods"
  )
  let bundleAirpods: {
    name: string
    handle: string
    variants: Record<string, { variantId: string; price: number; image: string | null }>
  } | null = null
  if (airpodsProduct) {
    const deviceOptId = airpodsProduct.options?.find(
      (o) => o.title.toLowerCase() === "device"
    )?.id
    const variants: Record<
      string,
      { variantId: string; price: number; image: string | null }
    > = {}
    for (const v of airpodsProduct.variants ?? []) {
      const dev = deviceOptId
        ? v.options?.find((o) => o.option_id === deviceOptId)?.value
        : undefined
      const price = v.calculated_price?.calculated_amount
      // Skip unpriced (Alcantara) so the bundle never offers/adds at ৳0.
      if (!dev || !(typeof price === "number" && price > 0)) continue
      // Keep the cheapest variant per AirPods model (its base construction).
      if (variants[dev] && variants[dev].price <= price) continue
      variants[dev] = {
        variantId: v.id,
        price,
        image:
          (v.metadata?.images as string[] | undefined)?.[0] ??
          airpodsProduct.thumbnail ??
          null,
      }
    }
    if (Object.keys(variants).length) {
      bundleAirpods = {
        name: (airpodsProduct.metadata?.design_name as string) ?? designName,
        handle: airpodsProduct.handle,
        variants,
      }
    }
  }

  // PAIRS WELL WITH: the same design in another form (AirPods case, wallet...).
  const pairsItems: RelatedProduct[] = pool
    .filter(
      (p) =>
        p.metadata?.design_slug === designSlug && p.handle !== product.handle
    )
    .slice(0, 3)
    .map((p) => ({
      id: p.id,
      title: (p.metadata?.design_name as string) ?? p.title,
      handle: p.handle,
      thumbnail: p.thumbnail,
      label: p.subtitle ?? "",
      price: minPrice(p),
    }))

  // RECOMMENDED FOR YOU: matching accessories — this same design in every other
  // form it is printed on (AirPods case, card holder, ring holder…). Auto for
  // now; admin curation lands later.
  const formLabelFor = (form?: unknown): string => {
    switch (String(form ?? "")) {
      case "airpods":
        return "AirPods Case"
      case "wallet":
        return "Wallet"
      case "watch":
        return "Watch Band"
      case "card":
        return "Card Holder"
      default:
        return "Accessory"
    }
  }
  // Each accessory's selectable models (one entry per device, cheapest kept),
  // so the card can offer a model picker before adding.
  const recommendedVariants = (p: StoreProduct): RecommendedVariant[] => {
    const devOptId = p.options?.find(
      (o) => o.title.toLowerCase() === "device"
    )?.id
    const byLabel = new Map<string, RecommendedVariant>()
    for (const v of p.variants ?? []) {
      const label =
        (devOptId
          ? v.options?.find((o) => o.option_id === devOptId)?.value
          : null) ??
        v.title ??
        "Default"
      const price = v.calculated_price?.calculated_amount ?? null
      const existing = byLabel.get(label)
      if (
        !existing ||
        (price != null && (existing.price == null || price < existing.price))
      ) {
        byLabel.set(label, { id: v.id, label, price })
      }
    }
    return [...byLabel.values()]
  }
  const recommendedItems: RecommendedItem[] = pool
    .filter(
      (p) =>
        p.metadata?.design_slug === designSlug && p.handle !== product.handle
    )
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      name: (p.metadata?.design_name as string) ?? designName,
      handle: p.handle,
      thumbnail: p.thumbnail ?? p.images?.[0]?.url ?? null,
      formLabel: p.subtitle ?? formLabelFor(p.metadata?.form),
      price: minPrice(p),
      variants: recommendedVariants(p),
    }))

  const fallbackImages = (product.images ?? []).map((i) => i.url)

  const facts = [
    ...(product.collection
      ? [{ label: "Collection", value: product.collection.title }]
      : []),
    { label: "Design", value: designName },
    {
      label: "Case types",
      value: matrix.caseTypes.join(", "),
    },
    {
      label: "Fits",
      value: `${matrix.devices.length} device${matrix.devices.length === 1 ? "" : "s"}`,
    },
  ]

  return (
    <article className="mx-auto w-full max-w-[1360px] px-0 md:px-[30px]">
      <ProductView
        pagePath={`/product/${slug}/`}
        matrix={productViewMatrix(matrix)}
        variants={productViewVariants(product.variants ?? [])}
        families={families}
        stock={stock}
        fallbackImages={fallbackImages}
        designName={designName}
        productHandle={product.handle}
        productTitle={product.title}
        collection={
          product.collection
            ? {
                title: product.collection.title,
                handle: product.collection.handle,
              }
            : null
        }
        deviceName={device?.name ?? null}
        initialCaseType={initialCaseType}
        initialDevice={initialDevice}
        fitCopy={deviceCopy}
        designData={designData}
        bundleConfig={bundleConfig}
        caseTypeRecords={caseTypes}
        bundleAirpods={bundleAirpods}
        shipping={<ShippingNote />}
        tabs={
          <ProductTabs
            description={product.description}
            caseTypeName={null}
            caseTypeDescription={product.description}
            facts={facts}
            designName={designName}
          />
        }
        pairs={<PairsWellWith items={pairsItems} />}
        recommendedItems={recommendedItems}
        featureBlocks={featureBlocks}
        productForm={(product.metadata?.form as string) ?? null}
        galleryVideos={galleryVideos}
      />
    </article>
  )
}
