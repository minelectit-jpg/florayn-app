import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import ProductBuyBox from "@/components/product-buy-box"
import ProductGallery, { type GalleryItem } from "@/components/product-gallery"
import {
  CaseTypeTiles,
  DesignReviews,
  MoreDesigns,
  PairsWellWith,
  ShippingNote,
  type RelatedProduct,
} from "@/components/product-sections"
import ProductTabs from "@/components/product-tabs"
import { getBundleConfig } from "@/lib/bundles"
import { getDesign, getDeviceFamilyMap } from "@/lib/catalog"
import { listProducts, type StoreProduct } from "@/lib/medusa"
import { getProductByHandle } from "@/lib/medusa"

type Params = { params: Promise<{ slug: string }> }

/** Cheapest variant, which is what a case-type tile shows. */
function minPrice(product: StoreProduct): number | null {
  const amounts = (product.variants ?? [])
    .map((v) => v.calculated_price?.calculated_amount)
    .filter((a): a is number => typeof a === "number")
  return amounts.length ? Math.min(...amounts) : null
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductByHandle(slug)

  if (!product) {
    return { title: "Not found" }
  }

  return {
    title: product.title,
    description: product.description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/product/${product.handle}/` },
  }
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params
  const product = await getProductByHandle(slug)

  if (!product) {
    notFound()
  }

  const designSlug = product.metadata?.design_slug as string | undefined
  const caseTypeSlug = product.metadata?.case_type_slug as string | undefined
  const caseTypeName = product.metadata?.case_type_name as string | undefined
  const designName = (product.metadata?.design_name as string) ?? product.title

  const [families, designData, bundles] = await Promise.all([
    getDeviceFamilyMap(),
    designSlug ? getDesign(designSlug) : Promise.resolve(null),
    getBundleConfig(),
  ])

  // The design route cannot join prices, so the sibling products are fetched
  // again through the Store API to price each case-type tile.
  const siblingIds = (designData?.products ?? []).map((p) => p.id)
  const { products: siblingProducts } = siblingIds.length
    ? await listProducts({ id: siblingIds, limit: 12 })
    : { products: [] as StoreProduct[] }
  const priceById = new Map(siblingProducts.map((p) => [p.id, minPrice(p)]))
  const thumbById = new Map(siblingProducts.map((p) => [p.id, p.thumbnail]))

  const caseTypeItems: RelatedProduct[] = (designData?.products ?? []).map(
    (sibling) => ({
      id: sibling.id,
      title: sibling.title,
      handle: sibling.handle,
      thumbnail: sibling.thumbnail ?? thumbById.get(sibling.id) ?? null,
      label: sibling.case_type_name ?? sibling.title,
      price: priceById.get(sibling.id) ?? null,
    })
  )

  // MORE DESIGNS: other artwork in the same finish. Prefer the collection the
  // design belongs to; 60 designs have none, so fall back to the case type's
  // own category.
  const collectionId = product.collection?.id
  const caseCategoryId = product.categories?.find(
    (c) => c.handle === caseTypeSlug
  )?.id
  const poolQuery = collectionId
    ? { collection_id: [collectionId], limit: 40 }
    : caseCategoryId
      ? { category_id: [caseCategoryId], limit: 40 }
      : null
  const { products: pool } = poolQuery
    ? await listProducts(poolQuery)
    : { products: [] as StoreProduct[] }

  const moreDesignItems: RelatedProduct[] = pool
    .filter(
      (p) =>
        p.metadata?.case_type_slug === caseTypeSlug &&
        p.metadata?.design_slug !== designSlug
    )
    .slice(0, 12)
    .map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      thumbnail: p.thumbnail,
      label: (p.metadata?.design_name as string) ?? p.title,
      price: minPrice(p),
    }))

  /*
   * "Pairs well with" on the live site is the same design in another product
   * form - an AirPods case beside a phone case. Here a device is a variant,
   * not a product, so the nearest true equivalent is the same design in a
   * construction that covers non-phone devices.
   */
  const accessoryFamilies = new Set(["AirPods", "Apple Watch", "Card Wallet"])
  const pairsItems: RelatedProduct[] = siblingProducts
    .filter((p) => {
      if (p.handle === product.handle) return false
      return (p.variants ?? []).some((v) =>
        accessoryFamilies.has(families[v.title] ?? "")
      )
    })
    .slice(0, 3)
    .map((p) => ({
      id: p.id,
      title: (p.metadata?.design_name as string) ?? p.title,
      handle: p.handle,
      thumbnail: p.thumbnail,
      label: (p.metadata?.case_type_name as string) ?? "",
      price: minPrice(p),
    }))

  const images = product.images ?? []
  const galleryItems: GalleryItem[] = images.map((image) => ({
    id: image.id,
    url: image.url,
    // No design-level video exists in the catalogue yet; the gallery renders
    // one as a slide as soon as a design carries a video URL.
    video: null,
  }))

  const deviceCount = product.variants?.length ?? 0
  const facts = [
    ...(product.collection
      ? [{ label: "Collection", value: product.collection.title }]
      : []),
    ...(caseTypeName ? [{ label: "Case type", value: caseTypeName }] : []),
    { label: "Design", value: designName },
    {
      label: "Fits",
      value: `${deviceCount} device${deviceCount === 1 ? "" : "s"}`,
    },
  ]

  return (
    <article className="mx-auto w-full max-w-[1260px] px-[30px]">
      <div className="grid gap-[30px] lg:grid-cols-[600px_minmax(0,570px)]">
        <div>
          <ProductGallery items={galleryItems} label={designName} />
        </div>

        <div className="lg:sticky lg:top-[50px] lg:self-start">
          {product.collection ? (
            <Link
              href={`/collection/${product.collection.handle}/`}
              className="eyebrow transition-colors hover:text-purple"
            >
              {product.collection.title}
            </Link>
          ) : null}

          <h1 className="mt-2 text-[1.625rem] font-semibold leading-tight tracking-[-0.034em]">
            {designName}
            {caseTypeName ? (
              <span className="text-ink-muted"> &ndash; {caseTypeName}</span>
            ) : null}
          </h1>

          <div className="mt-3">
            <ProductBuyBox
              variants={product.variants ?? []}
              families={families}
              productTitle={product.title}
              thumbnail={product.thumbnail ?? images[0]?.url ?? null}
              moreDesigns={<MoreDesigns items={moreDesignItems} />}
              caseTypes={
                <CaseTypeTiles
                  items={caseTypeItems}
                  currentHandle={product.handle}
                />
              }
              shipping={<ShippingNote />}
              bundles={bundles}
            />
          </div>

          <ProductTabs
            description={product.description}
            caseTypeName={caseTypeName}
            caseTypeDescription={product.description}
            facts={facts}
            reviews={<DesignReviews designName={designName} />}
          />

          <PairsWellWith items={pairsItems} />
        </div>
      </div>
    </article>
  )
}
