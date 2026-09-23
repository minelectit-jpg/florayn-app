"use client"

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"

import type { MatchingProduct } from "@/components/pack-selector"
import FeaturesSection from "@/components/features-section"
import LazyReveal from "@/components/lazy-reveal"
import ProductBuyBox from "@/components/product-buy-box"
import ProductDetailsSticky from "@/components/product-details-sticky"
import YouWillLove from "@/components/you-will-love"
import RecommendedForYou, {
  type RecommendedItem,
} from "@/components/recommended-for-you"
import ProductGallery, { type GalleryItem } from "@/components/product-gallery"
import { MoreDesigns } from "@/components/product-sections"
import type { BundleConfig } from "@/lib/bundles"
import type { FeatureBlock, GalleryVideoMap } from "@/lib/content"
import { featuresGroup } from "@/lib/product-forms"
import type { CaseTypeRecord } from "@/lib/catalog"
import type { StoreVariant } from "@/lib/medusa"
import {
  expandProductViewDesigns,
  type ProductDesignData,
  type ProductVariantMatrix,
} from "@/lib/product-view-data"
import { pairKey } from "@/lib/variant-matrix"

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
  pagePath,
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
  designData,
  bundleConfig,
  caseTypeRecords,
  matchingProduct,
  shipping,
  deliveryEstimate,
  tabs,
  reviewSummary,
  recommendedItems,
  manualFeaturedItems,
  featureBlocks,
  productForm,
  galleryVideos,
  simple = false,
  optionLabel,
}: {
  pagePath: string
  matrix: ProductVariantMatrix
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
  /** Shared choices for related designs, featured picks and mixed-device packs. */
  designData: ProductDesignData
  /** Multi-buy tier config for the pack selector, or null when off. */
  bundleConfig?: BundleConfig | null
  /** Construction records for the pack picker's case-type popup. */
  caseTypeRecords?: CaseTypeRecord[]
  /** This design's AirPods case for the Matching Set bundle, or null. */
  matchingProduct?: MatchingProduct | null
  shipping?: ReactNode
  /** Admin delivery estimate shown after "In stock" (Product delivery). */
  deliveryEstimate?: string
  tabs: ReactNode
  /** Stars + review count, linked to the Reviews row; shown above the title. */
  reviewSummary?: ReactNode
  /**
   * Recommended-for-you accessories, shown under the gallery in the left column
   * on desktop (below the buy box on mobile). Passed as data, not a rendered
   * node, so the band can load client-side only.
   */
  recommendedItems?: RecommendedItem[]
  manualFeaturedItems?: RecommendedItem[]
  /** Feature blocks (all groups); the band picks the live group's set. */
  featureBlocks?: FeatureBlock[]
  /** The product's form ("phone", "airpods"…); keys the Features band. */
  productForm?: string | null
  /** Design gallery videos, keyed by case type; shown first when one matches. */
  galleryVideos?: GalleryVideoMap
  /**
   * Simple mode: a non-case product (e.g. a StickPad) rendered through this same
   * page. Its single option's values are the tiles (colours) and there is no
   * device selector or multi-buy widget, so the store keeps ONE product page.
   */
  simple?: boolean
  /** The option label for the simple-mode tiles (e.g. "Color"). */
  optionLabel?: string
}) {
  const [hydratedPath, setHydratedPath] = useState<string | null>(null)
  useEffect(() => { setHydratedPath(pagePath) }, [pagePath])
  const { moreDesignItems, packDesigns, youWillLoveItems } = useMemo(
    () => expandProductViewDesigns(designData),
    [designData]
  )
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
    const params = new URLSearchParams(window.location.search)
    const variant = params.get("variant")
    if (variant) {
      for (const ct of matrix.caseTypes) {
        for (const model of matrix.devicesByCaseType[ct] ?? []) {
          if (matrix.variantIdByPair[pairKey(ct, model)] === variant) {
            setCaseType(ct); setDevice(model); return
          }
        }
      }
    }
    const slug = params.get("case")
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
    // Simple products use one sentinel device "" (falsy), so guard on the list
    // being empty, not on the device string being truthy.
    if (!devs.length) return undefined
    const dev = devs.includes(device) ? device : devs[0]
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

  // The phone title is sized to fit one line from its length alone - the same
  // on the server and the client, so nothing is measured after paint. It is
  // based on the longest model this design comes in, so switching model never
  // changes the size.
  const longestDevice = matrix.devices.reduce((n, d) => Math.max(n, d.length), device.length)
  const titleChars = device ? designName.length + longestDevice + 8 : designName.length

  return (
    <div data-product-ready data-product-path={pagePath} data-product-hydrated={hydratedPath === pagePath}
      className="grid grid-cols-1 items-start gap-3.5 md:gap-[30px] lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-x-[56px] lg:grid-rows-[max-content_1fr]">
      <div className="lg:col-start-1 lg:row-start-1">
        <ProductGallery
          key={selected?.id ?? "default"}
          items={items}
          label={designName}
        />
      </div>

      <ProductDetailsSticky>
        {/* Reviews first, then the title, then (in the buy box) the price and
            the live stock/delivery line. Stock lives in the buy box so it uses
            the refreshed availability the Add to cart button uses. */}
        {reviewSummary}

        {/* "Design – Device Case". On a phone it stays on one line: only the
            design name can shorten, never the model. The full text is always
            in the heading. It follows the live device. */}
        <h1 className="fl-pdp-title" style={{ "--title-chars": titleChars } as CSSProperties}>
          {device ? (
            <>
              <span className="fl-pdp-title__name">{designName}</span>
              <span className="fl-pdp-title__model">{` – ${device} Case`}</span>
            </>
          ) : (
            <span className="fl-pdp-title__name">{designName}</span>
          )}
        </h1>

        <div className="mt-1.5 md:mt-3">
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
            matchingProduct={matchingProduct ?? null}
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
                  currentName={designName}
                  currentImage={
                    (selected?.metadata?.images as string[] | undefined)?.[0] ??
                    fallbackImages[0] ??
                    null
                  }
                />
              ) : null
            }
            shipping={shipping}
            deliveryEstimate={deliveryEstimate}
            simple={simple}
            optionLabel={optionLabel}
          />
        </div>

        {tabs}
      </ProductDetailsSticky>

      {recommendedItems?.length ||
      featureBlocks?.length || manualFeaturedItems?.length ||
      youWillLoveItems?.length ? (
        <div className="lg:col-start-1 lg:row-start-2">
          {/* Below the fold: mount only when the viewport nears it, so the
              buy box + gallery hydrate first on a low-end phone. */}
          <LazyReveal minHeight={360}>
            <div className="fl-pdp-strips">
              <RecommendedForYou items={recommendedItems ?? []} />
              <RecommendedForYou items={manualFeaturedItems ?? []} title="We think you’ll love" />
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
          </LazyReveal>
        </div>
      ) : null}
    </div>
  )
}
