import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ProductView from "@/components/product-view"
import {
  type RecommendedItem,
  type RecommendedVariant,
} from "@/components/recommended-for-you"
import RegularProductView from "@/components/regular-product-view"
import { type YouWillLoveItem } from "@/components/you-will-love"
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
  getProductByHandle,
  listProducts,
  type StoreProduct,
} from "@/lib/medusa"
import { fitCopy, getSeoConfig, resolveSeo } from "@/lib/seo-copy"
import { buildVariantMatrix } from "@/lib/variant-matrix"

type Params = {
  params: Promise<{ slug: string }>
}

export const dynamicParams = true
// ISR: pages are cached and served instantly (even the first ad visitor gets a
// prebuilt page), then rebuilt in the background at most this often. `?case=` is
// read on the client instead of via searchParams, so the route stays static and
// does not fall back to per-request rendering.
export const revalidate = 600

/*
 * Prerender the LIVE product base pages at build so ad traffic lands on an
 * already-cached page. The full catalogue (every design x device) is too large
 * to prerender on this single-process host, so device-specific and not-yet-live
 * pages are generated on first hit and then cached (dynamicParams).
 */
export async function generateStaticParams() {
  try {
    const { products } = await listProducts({
      fields: "handle",
      limit: 1000,
    })
    return (products ?? [])
      .map((p) => p.handle)
      .filter(Boolean)
      .map((slug) => ({ slug }))
  } catch {
    return [] as { slug: string }[]
  }
}

/** Cheapest variant of a product, for a card's "From" price. */
function minPrice(product: StoreProduct): number | null {
  const amounts = (product.variants ?? [])
    .map((v) => v.calculated_price?.calculated_amount)
    .filter((a): a is number => typeof a === "number")
  return amounts.length ? Math.min(...amounts) : null
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
  const resolved = await resolveProductPage(slug)
  if (!resolved) notFound()

  const { product, device } = resolved

  const designSlug = product.metadata?.design_slug as string | undefined
  const designName = (product.metadata?.design_name as string) ?? product.title

  // One parallel round for everything that only needs the product itself; the
  // page used to await these one by one, which was most of its slow TTFB.
  const [
    families,
    deviceCatalog,
    stock,
    caseTypes,
    bundleConfig,
    productSections,
  ] = await Promise.all([
    getDeviceFamilyMap(),
    getDeviceCatalog(),
    getBlankStock(),
    getCaseTypes(),
    getBundleConfig(),
    getProductSections(),
  ])
  const { featureBlocks, featuredPicks } = productSections

  // The (Case Type x Device) matrix drives both selectors and the gallery.
  const matrix = buildVariantMatrix(product)

  // A regular product (no Case Type + Device options) - e.g. a manually-added
  // one-off - renders as a plain product page instead of the linked selectors.
  if (!(matrix.caseTypes.length && matrix.devices.length)) {
    return (
      <article className="mx-auto w-full max-w-[1360px] px-0 md:px-[30px]">
        <RegularProductView
          product={product}
          featureBlocks={featureBlocks}
          collection={
            product.collection
              ? {
                  title: product.collection.title,
                  handle: product.collection.handle,
                }
              : null
          }
        />
      </article>
    )
  }

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
  if (device) {
    const seo = resolveSeo({
      config: await getSeoConfig(),
      designSlug,
      deviceSlug: device.slug,
      values: { design: designName, device: device.name, caseType: "" },
    })
    deviceCopy = seo.fitCopyEnabled
      ? (seo.fitCopyOverride ?? fitCopy(device.name, device.slug))
      : null
  }

  // Related products (this design's collection) and the design's gallery videos,
  // fetched together.
  const collectionId = product.collection?.id
  const [poolResult, galleryVideos] = await Promise.all([
    collectionId
      ? listProducts({ collection_id: [collectionId], limit: 100 })
      : Promise.resolve({ products: [] as StoreProduct[] }),
    getGalleryVideos(designSlug ?? ""),
  ])
  const { products: pool } = poolResult

  // MORE DESIGNS: other designs' phone cases in the same collection. Each one
  // carries renders keyed by "device|caseType" (and by device alone) so the
  // strip can follow the customer's exact model + finish.
  const rendersFor = (
    p: StoreProduct
  ): { pair: Record<string, string>; device: Record<string, string> } => {
    const optId = (title: string) =>
      p.options?.find((o) => o.title.toLowerCase() === title)?.id
    const deviceOptId = optId("device")
    const caseOptId = optId("case type")
    const pair: Record<string, string> = {}
    const device: Record<string, string> = {}
    if (!deviceOptId) return { pair, device }
    for (const v of p.variants ?? []) {
      const dev = v.options?.find((o) => o.option_id === deviceOptId)?.value
      if (!dev) continue
      const img = (v.metadata?.images as string[] | undefined)?.[0]
      if (!img) continue
      if (!device[dev]) device[dev] = img
      const ct = caseOptId
        ? v.options?.find((o) => o.option_id === caseOptId)?.value
        : undefined
      if (ct) {
        const key = `${dev}|${ct}`
        if (!pair[key]) pair[key] = img
      }
    }
    return { pair, device }
  }

  const otherPhoneDesigns = pool.filter(
    (p) =>
      p.metadata?.form === "phone" && p.metadata?.design_slug !== designSlug
  )

  const moreDesignItems: RelatedProduct[] = otherPhoneDesigns
    .slice(0, 12)
    .map((p) => {
      const renders = rendersFor(p)
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        thumbnail: p.thumbnail,
        label: (p.metadata?.design_name as string) ?? p.title,
        price: minPrice(p),
        // imageByPair keeps the strip on the customer's exact choice - the same
        // case type on the same device - so it never falls back to another
        // finish (e.g. showing Armor tiles while Signature is selected).
        // imageByDevice is the fallback when a design lacks that precise pair.
        imageByPair: renders.pair,
        imageByDevice: renders.device,
      }
    })

  // WE THINK YOU'LL LOVE: the admin's hand-picked designs. Each is reduced to a
  // compact, device+case-type-aware shape (renders and a variant per pair) so
  // the card follows the live selection without embedding four whole products
  // (~600KB) in the page.
  const pickedProducts = featuredPicks?.length
    ? (
        await Promise.all(featuredPicks.map((h) => getProductByHandle(h)))
      ).filter((p): p is StoreProduct => Boolean(p))
    : []
  const youWillLoveItems: YouWillLoveItem[] = pickedProducts.map((p) => {
    const renders = rendersFor(p)
    const optId = (t: string) =>
      p.options?.find((o) => o.title.toLowerCase() === t)?.id
    const devOpt = optId("device")
    const caseOpt = optId("case type")
    const variantByPair: Record<string, { id: string; price: number }> = {}
    for (const v of p.variants ?? []) {
      const dev = devOpt
        ? v.options?.find((o) => o.option_id === devOpt)?.value
        : undefined
      const ct = caseOpt
        ? v.options?.find((o) => o.option_id === caseOpt)?.value
        : undefined
      if (!dev || !ct) continue
      const key = `${dev}|${ct}`
      if (!variantByPair[key]) {
        variantByPair[key] = {
          id: v.id,
          price: v.calculated_price?.calculated_amount ?? 0,
        }
      }
    }
    return {
      id: p.id,
      name: (p.metadata?.design_name as string) ?? p.title,
      handle: p.handle,
      thumbnail: p.thumbnail ?? null,
      imageByPair: renders.pair,
      imageByDevice: renders.device,
      variantByPair,
      price: minPrice(p),
    }
  })

  // PACK PICKER: every other phone design with its variant id + price + render
  // per "device|caseType", so the Choose-a-design modal can offer and add them
  // without a cross-origin browser call.
  const packDesigns = otherPhoneDesigns.map((p) => {
    const optId = (title: string) =>
      p.options?.find((o) => o.title.toLowerCase() === title)?.id
    const deviceOptId = optId("device")
    const caseOptId = optId("case type")
    const variants: Record<
      string,
      { variantId: string; price: number; image: string | null }
    > = {}
    for (const v of p.variants ?? []) {
      const dev = deviceOptId
        ? v.options?.find((o) => o.option_id === deviceOptId)?.value
        : undefined
      const ct = caseOptId
        ? v.options?.find((o) => o.option_id === caseOptId)?.value
        : undefined
      if (!dev || !ct) continue
      const key = `${dev}|${ct}`
      if (variants[key]) continue
      variants[key] = {
        variantId: v.id,
        price: v.calculated_price?.calculated_amount ?? 0,
        image:
          (v.metadata?.images as string[] | undefined)?.[0] ??
          p.thumbnail ??
          null,
      }
    }
    return {
      handle: (p.metadata?.design_slug as string) ?? p.handle,
      name: (p.metadata?.design_name as string) ?? p.title,
      thumbnail: p.thumbnail ?? null,
      variants,
    }
  })

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
      if (!dev) continue
      const price = v.calculated_price?.calculated_amount ?? 0
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
        matrix={matrix}
        variants={product.variants ?? []}
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
        moreDesignItems={moreDesignItems}
        bundleConfig={bundleConfig}
        packDesigns={packDesigns}
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
        youWillLoveItems={youWillLoveItems}
      />
    </article>
  )
}
