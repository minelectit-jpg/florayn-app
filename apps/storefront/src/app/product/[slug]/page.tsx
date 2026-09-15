import type { Metadata } from "next"
import { notFound } from "next/navigation"

import ProductView from "@/components/product-view"
import RegularProductView from "@/components/regular-product-view"
import {
  PairsWellWith,
  ShippingNote,
  type RelatedProduct,
} from "@/components/product-sections"
import ProductTabs from "@/components/product-tabs"
import { getBlankStock, getDeviceCatalog, getDeviceFamilyMap } from "@/lib/catalog"
import { resolveProductPage } from "@/lib/device-page"
import { listProducts, type StoreProduct } from "@/lib/medusa"
import { fitCopy, getSeoConfig, resolveSeo } from "@/lib/seo-copy"
import { buildVariantMatrix } from "@/lib/variant-matrix"

type Params = { params: Promise<{ slug: string }> }

export const dynamicParams = true
export const revalidate = 86400

/*
 * Prerender nothing by default; each product/device page renders on first
 * request and is cached. See the note kept through the Structure B rewrite: the
 * catalogue is too large to prerender on this single-process host.
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

  const [families, deviceCatalog, stock] = await Promise.all([
    getDeviceFamilyMap(),
    getDeviceCatalog(),
    getBlankStock(),
  ])

  // The (Case Type x Device) matrix drives both selectors and the gallery.
  const matrix = buildVariantMatrix(product)

  // A regular product (no Case Type + Device options) - e.g. a manually-added
  // one-off - renders as a plain product page instead of the linked selectors.
  if (!(matrix.caseTypes.length && matrix.devices.length)) {
    return (
      <article className="mx-auto w-full max-w-[1260px] px-[30px]">
        <RegularProductView
          product={product}
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

  // Related products, drawn from this design's collection.
  const collectionId = product.collection?.id
  const { products: pool } = collectionId
    ? await listProducts({ collection_id: [collectionId], limit: 100 })
    : { products: [] as StoreProduct[] }

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

  const moreDesignItems: RelatedProduct[] = pool
    .filter(
      (p) =>
        p.metadata?.form === "phone" && p.metadata?.design_slug !== designSlug
    )
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
        imageByPair: renders.pair,
        imageByDevice: renders.device,
      }
    })

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
    <article className="mx-auto w-full max-w-[1260px] px-[30px]">
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
      />
    </article>
  )
}
