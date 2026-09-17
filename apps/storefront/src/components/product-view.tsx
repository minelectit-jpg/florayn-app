"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useState, type ReactNode } from "react"

import type { PackDesign } from "@/components/choose-design-modal"
import type { BundleAirpods } from "@/components/pack-selector"
import ProductBuyBox from "@/components/product-buy-box"
import { type YouWillLoveItem } from "@/components/you-will-love"
import { type RecommendedItem } from "@/components/recommended-for-you"
import ProductGallery, { type GalleryItem } from "@/components/product-gallery"
import { MoreDesigns, type RelatedProduct } from "@/components/product-sections"
import type { BundleConfig } from "@/lib/bundles"
import type { FeatureBlock, GalleryVideoMap } from "@/lib/content"
import { featuresGroup } from "@/lib/product-forms"
import type { CaseTypeRecord } from "@/lib/catalog"
import type { StoreProduct, StoreVariant } from "@/lib/medusa"
import { pairKey, type VariantMatrix } from "@/lib/variant-matrix"

// The three bands under the gallery — Recommended, We-think-you'll-love and
// Features — all sit below the fold. Loading them client-side only (ssr: false)
// keeps them out of the initial HTML and the first JS chunk, so the gallery and
// buy box (the only things a first-time visitor sees) paint and hydrate first;
// the bands mount a moment later, well before they scroll into view.
const RecommendedForYou = dynamic(
  () => import("@/components/recommended-for-you"),
  { ssr: false }
)
const YouWillLove = dynamic(() => import("@/components/you-will-love"), {
  ssr: false,
})
const FeaturesSection = dynamic(() => import("@/components/features-section"), {
  ssr: false,
})

/**
 * The two-column top of the product page.
 *
 * Structure B: one design product with two options, Case Type and Device. Both
 * are picked in place here - no navigating to a sibling product - and the two
 * selectors are linked, so choosing a device greys out the case types that do
 * not fit it and vice versa. The gallery follows the exact (case type, device)
 * variant, each of which carries its own renders in metadata.
 */
export default function ProductView({
  matrix,
  variants,
  families,
  stock,
  fallbackImages,
  designName,
  productHandle,
  productTitle,
  initialCaseType,
  initialDevice,
  moreDesignItems,
  bundleConfig,
  packDesigns,
  caseTypeRecords,
  bundleAirpods,
  shipping,
  tabs,
  pairs,
  recommendedItems,
  featureBlocks,
  productForm,
  galleryVideos,
  youWillLoveItems,
}: {
  matrix: VariantMatrix
  variants: StoreVariant[]
  /** device name -> family label, for grouping the device drawer. */
  families: Record<string, string>
  /** "<Case Type>|<Device>" -> available quantity (shared blank stock). */
  stock: Record<string, number>
  /** Used when a variant has no wired renders yet. */
  fallbackImages: string[]
  designName: string
  /** The product handle, passed through as the wishlist's stable key. */
  productHandle: string
  productTitle: string
  collection?: { title: string; handle: string } | null
  /** Set on a device page: the device this URL is for (drives the H1). */
  deviceName?: string | null
  initialCaseType: string
  initialDevice: string
  fitCopy?: string | null
  /** Sibling designs for the MORE DESIGNS strip; rendered on the live device. */
  moreDesignItems?: RelatedProduct[]
  /** Multi-buy tier config for the pack selector, or null when off. */
  bundleConfig?: BundleConfig | null
  /** Other designs a pack slot can be filled from (prepared server-side). */
  packDesigns?: PackDesign[]
  /** Construction records for the pack picker's case-type popup. */
  caseTypeRecords?: CaseTypeRecord[]
  /** This design's AirPods case for the Matching Set bundle, or null. */
  bundleAirpods?: BundleAirpods | null
  shipping?: ReactNode
  tabs: ReactNode
  pairs: ReactNode
  /**
   * Recommended-for-you accessories, shown under the gallery in the left column
   * on desktop (below the buy box on mobile). Passed as data, not a rendered
   * node, so the band can load client-side only.
   */
  recommendedItems?: RecommendedItem[]
  /** Feature blocks (all groups); the band picks the live group's set. */
  featureBlocks?: FeatureBlock[]
  /** The product's form ("phone", "airpods"…); keys the Features band. */
  productForm?: string | null
  /** Design gallery videos, keyed by case type; shown first when one matches. */
  galleryVideos?: GalleryVideoMap
  /** Admin-picked designs for "We think you'll love"; rendered on the live pair. */
  youWillLoveItems?: YouWillLoveItem[]
}) {
  const variantById = useMemo(
    () => new Map(variants.map((v) => [v.id, v])),
    [variants]
  )

  const [caseType, setCaseType] = useState(initialCaseType)
  const [device, setDevice] = useState(initialDevice)

  // Snap to a valid pair when a change makes the current one impossible.
  function selectCaseType(ct: string) {
    setCaseType(ct)
    const devs = matrix.devicesByCaseType[ct] ?? []
    if (!devs.includes(device) && devs[0]) setDevice(devs[0])
  }
  function selectDevice(d: string) {
    setDevice(d)
    const cts = matrix.caseTypesByDevice[d] ?? []
    if (!cts.includes(caseType) && cts[0]) setCaseType(cts[0])
  }

  // Honour ?case=<slug> from a filtered shop card, on the client so the page
  // itself stays static/cacheable. Runs once after hydration.
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("case")
    if (!slug) return
    const name = caseTypeRecords?.find((c) => c.slug === slug)?.name
    if (name && matrix.caseTypes.includes(name)) selectCaseType(name)
  }, [])

  const selectedId = matrix.variantIdByPair[pairKey(caseType, device)]
  const selected = (selectedId && variantById.get(selectedId)) || null

  const items: GalleryItem[] = useMemo(() => {
    const imgs = (selected?.metadata?.images as string[] | undefined) ?? []
    const urls = imgs.length ? imgs : fallbackImages
    const imageItems = urls.map((url, i) => ({
      id: `${selected?.id ?? "default"}-${i}`,
      url,
      video: null,
    }))
    // A design's gallery video is keyed by case type (device-agnostic). It sits
    // at its chosen 1-based slot, clamped to however many images this variant
    // has (slot 6 lands last when there are only 2 images) and never at the very
    // front — an image always leads, so the page opens on the render, not the
    // clip.
    const gv = galleryVideos?.[caseType]
    if (gv?.video_url) {
      const videoItem: GalleryItem = {
        id: `gv-${caseType}`,
        // Empty poster → the gallery shows the clip's own first frame.
        url: gv.poster_url ?? "",
        video: gv.video_url,
      }
      const at = Math.min(
        Math.max((gv.position ?? 2) - 1, imageItems.length ? 1 : 0),
        imageItems.length
      )
      return [...imageItems.slice(0, at), videoItem, ...imageItems.slice(at)]
    }
    return imageItems
  }, [selected?.id, selected?.metadata, fallbackImages, galleryVideos, caseType])

  // The picture / price a case-type tile shows: that case type at the current
  // device when it fits, otherwise at the case type's own first device.
  function variantForCaseType(ct: string): StoreVariant | undefined {
    const devs = matrix.devicesByCaseType[ct] ?? []
    const dev = devs.includes(device) ? device : devs[0]
    if (!dev) return undefined
    const id = matrix.variantIdByPair[pairKey(ct, dev)]
    return id ? variantById.get(id) : undefined
  }
  function imageForCaseType(ct: string): string | null {
    const imgs =
      (variantForCaseType(ct)?.metadata?.images as string[] | undefined) ?? []
    return imgs[0] ?? null
  }
  function priceForCaseType(ct: string): number | null {
    return variantForCaseType(ct)?.calculated_price?.calculated_amount ?? null
  }

  return (
    <div className="grid grid-cols-1 items-start gap-[30px] lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-x-[56px] lg:grid-rows-[max-content_1fr]">
      <div className="lg:col-start-1 lg:row-start-1">
        <ProductGallery
          key={selected?.id ?? "default"}
          items={items}
          label={designName}
        />
      </div>

      <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-[50px] lg:self-start">
        {/* Stock badge, above the title like florayn's "N in stock". Reflects
            the live (case type, device) blank; an untracked pair reads as in
            stock. */}
        {(() => {
          const n = stock[`${caseType}|${device}`]
          const inStock = n === undefined || n > 0
          return (
            <p
              className={`mb-1.5 text-[15px] ${inStock ? "text-[#444]" : "text-danger"}`}
            >
              {inStock ? "In stock" : "Sold out"}
            </p>
          )
        })()}

        {/* Title only, matching florayn: "Design – Device Case", no collection
            eyebrow, no case-type suffix, no fit paragraph above the price. It
            follows the live device so an in-place model change keeps it true. */}
        <h1 className="text-[1.625rem] font-semibold leading-[1.21] tracking-[-0.034em] text-[#111]">
          {device ? `${designName} – ${device} Case` : designName}
        </h1>

        <div className="mt-3">
          <ProductBuyBox
            matrix={matrix}
            selected={selected}
            families={families}
            stock={stock}
            productHandle={productHandle}
            productTitle={productTitle}
            designName={designName}
            bundleConfig={bundleConfig ?? null}
            packDesigns={packDesigns ?? []}
            caseTypeRecords={caseTypeRecords ?? []}
            bundleAirpods={bundleAirpods ?? null}
            thumbnail={items[0]?.url ?? null}
            caseType={caseType}
            device={device}
            onSelectCaseType={selectCaseType}
            onSelectDevice={selectDevice}
            imageForCaseType={imageForCaseType}
            priceForCaseType={priceForCaseType}
            moreDesigns={
              moreDesignItems?.length ? (
                <MoreDesigns
                  items={moreDesignItems}
                  device={device}
                  caseType={caseType}
                />
              ) : null
            }
            shipping={shipping}
          />
        </div>

        {tabs}
        {pairs}
      </div>

      {recommendedItems?.length ||
      featureBlocks?.length ||
      youWillLoveItems?.length ? (
        <div className="lg:col-start-1 lg:row-start-2">
          <RecommendedForYou items={recommendedItems ?? []} />
          <YouWillLove
            items={youWillLoveItems ?? []}
            device={device}
            caseType={caseType}
          />
          <FeaturesSection
            blocks={featureBlocks ?? []}
            group={featuresGroup(productForm, caseType)}
          />
        </div>
      ) : null}
    </div>
  )
}
