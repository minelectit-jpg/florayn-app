"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import type { MatchingProduct } from "@/components/pack-selector"
import FeaturesSection from "@/components/features-section"
import LazyReveal from "@/components/lazy-reveal"
import ProductBuyBox, { type PhoneColourControl } from "@/components/product-buy-box"
import ProductDetailsSticky from "@/components/product-details-sticky"
import YouWillLove from "@/components/you-will-love"
import RecommendedForYou, {
  type RecommendedItem,
} from "@/components/recommended-for-you"
import ProductGallery, { type GalleryItem } from "@/components/product-gallery"
import { MoreDesigns } from "@/components/product-sections"
import type { BundleConfig } from "@/lib/bundles"
import type { FeatureBlock, GalleryVideoMap } from "@/lib/content"
import type { BuyBoxPresentation } from "@/lib/storefront-presentation"
import { featuresGroup } from "@/lib/product-forms"
import type { CaseTypeRecord } from "@/lib/catalog"
import type { StoreVariant } from "@/lib/medusa"
import {
  colourFromQuery,
  expandGalleries,
  phoneColourView,
  settleColour,
  type ProductPhoneColours,
} from "@/lib/phone-colours"
import {
  expandProductViewDesigns,
  type ProductDesignData,
  type ProductVariantMatrix,
} from "@/lib/product-view-data"
import { track } from "@/lib/tracking/queue"
import { pairKey } from "@/lib/variant-matrix"

export type ProductPick = { caseType: string; device: string }

const NO_IMAGES: string[] = []

/**
 * What the page's query asks for, read once after hydration so the page
 * itself stays static: ?variant=<id>; else ?device=<model> (a link from an
 * order in the admin) with an optional ?case=<slug>; else ?case=<slug> alone
 * (a filtered shop card, the menu or search). null leaves the pick as it is.
 *
 * On a device page the path names the phone, so ?case= never swaps it: a
 * case type that device is not sold in is ignored (the page keeps its own
 * first case type) instead of snapping to another model and letting the
 * shopper add the wrong phone to the bag. On the design page a ?case= still
 * moves to a device that case type is sold for.
 */
export function pickFromQuery(
  search: string,
  matrix: ProductVariantMatrix,
  caseTypeRecords: Pick<CaseTypeRecord, "slug" | "name">[] | undefined,
  current: ProductPick,
  devicePage: boolean
): ProductPick | null {
  const params = new URLSearchParams(search)
  const variant = params.get("variant")
  if (variant) {
    for (const ct of matrix.caseTypes) {
      for (const model of matrix.devicesByCaseType[ct] ?? []) {
        if (matrix.variantIdByPair[pairKey(ct, model)] === variant) return { caseType: ct, device: model }
      }
    }
  }
  const slug = params.get("case")
  const name = slug ? caseTypeRecords?.find((c) => c.slug === slug)?.name : undefined
  const wanted = params.get("device")?.trim().toLowerCase()
  const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const model = wanted ? Object.keys(matrix.caseTypesByDevice).find((d) => d.toLowerCase() === wanted || slugOf(d) === slugOf(wanted)) : undefined
  if (model) {
    // Set both at once: the case type has to be one sold for that model.
    const fits = matrix.caseTypesByDevice[model] ?? []
    const caseType = name && fits.includes(name) ? name : !fits.includes(current.caseType) && fits[0] ? fits[0] : current.caseType
    return { caseType, device: model }
  }
  if (!name || !matrix.caseTypes.includes(name)) return null
  if (devicePage) {
    return (matrix.caseTypesByDevice[current.device] ?? []).includes(name) ? { caseType: name, device: current.device } : null
  }
  // Snap to a device that case type is sold for, as picking it by hand does.
  const devs = matrix.devicesByCaseType[name] ?? []
  return { caseType: name, device: !devs.includes(current.device) && devs[0] ? devs[0] : current.device }
}

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
  deviceName,
  initialCaseType,
  initialDevice,
  designData,
  bundleConfig,
  caseTypeRecords,
  matchingProduct,
  buyBox,
  deliveryEstimate,
  tabs,
  reviewSummary,
  recommendedItems,
  manualFeaturedItems,
  featureBlocks,
  productForm,
  galleryVideos,
  phoneColours,
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
  /** Admin > Buy buttons. */
  buyBox: BuyBoxPresentation
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
   * Phone colour pictures (PHONE_COLOURS.md): every variant's colours, with
   * the first model's pictures inline. Absent for legacy pictures. The colour
   * only changes the pictures, never the variant, price, stock or bag line.
   */
  phoneColours?: ProductPhoneColours | null
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

  // Phone colour (PHONE_COLOURS.md): a preference that survives model and case
  // switches. It starts null on the server and the client, so the first render
  // is always the main colour: the same hero, no hydration mismatch. Nothing
  // remembers it across visits (that would mean a second hero download).
  const colourView = useMemo(() => phoneColourView(phoneColours), [phoneColours])
  const [colourPref, setColourPref] = useState<string | null>(null)
  /** Other models' extra colours: variant ID -> pictures by colour; 0 while loading, 1 after a failure. */
  const [lazyColours, setLazyColours] = useState<Record<string, Record<string, string[]> | 0 | 1>>({})
  /** Variants already asked for, so a timer from an earlier render never asks twice. */
  const colourAsked = useRef<Record<string, 1>>({})
  /** Set by the shopper's own model or case switch; the page's pair never loads. */
  const switched = useRef(false)

  /**
   * Loads one variant's extra colours from the same-origin route, once. Only
   * for a variant with colours that the page does not carry. A failure leaves
   * the main colour showing; only a tap on a dot (`retry`) asks again, so a
   * dead connection never loops.
   */
  function loadColours(id: string, retry?: boolean) {
    const asked = colourAsked.current
    if ((asked[id] && !(retry && lazyColours[id] === 1)) || colourView.hasInline(id) || !colourView.optionsFor(id).length) return
    asked[id] = 1
    const done = (value: Record<string, string[]> | 0 | 1) => setLazyColours((all) => ({ ...all, [id]: value }))
    done(0)
    fetch(`/api/phone-colours/${id}/`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => done(expandGalleries(data)))
      .catch(() => done(1))
  }

  // Snap to a valid pair when a change makes the current one impossible.
  function selectCaseType(ct: string) {
    switched.current = true
    setCaseType(ct)
    const devs = matrix.devicesByCaseType[ct] ?? []
    if (!devs.includes(device) && devs[0]) setDevice(devs[0])
  }
  function selectDevice(d: string) {
    switched.current = true
    setDevice(d)
    const cts = matrix.caseTypesByDevice[d] ?? []
    if (!cts.includes(caseType) && cts[0]) setCaseType(cts[0])
  }

  // This mount's ViewContent (TRACKING.md 5.4): its variant and how many
  // variant switches were sent after it. A ref, so StrictMode's second effect
  // run sends nothing more, while every new mount (A -> B -> A) sends its own.
  const viewed = useRef<{ id: string; n: number } | null>(null)

  /** Queues a ViewContent for a pair; its variant id, or null without a price. */
  function trackView(ct: string, dev: string, primary: boolean): string | null {
    const id = matrix.variantIdByPair[pairKey(ct, dev)]
    const price = id ? variantById.get(id)?.calculated_price?.calculated_amount : null
    if (typeof price !== "number") return null
    track("ViewContent", { items: [{ id, q: 1, price }], value: price, currency: "BDT",
      handle: productHandle, device: dev, case_type: ct, primary })
    return id
  }

  // Honour ?variant=, ?device= and ?case= (see pickFromQuery) on the client so
  // the page itself stays static/cacheable. Runs once after hydration, which is
  // also when the page's ViewContent goes out, for the pair the query settles on.
  useEffect(() => {
    const devicePage = !!deviceName && deviceName === initialDevice
    const pick = pickFromQuery(window.location.search, matrix, caseTypeRecords, { caseType, device }, devicePage)
    const at = pick || { caseType, device }
    if (!viewed.current) {
      const id = trackView(at.caseType, at.device, true)
      if (id) viewed.current = { id, n: 0 }
    }
    // ?color=<slug> (a card on a shop colour page) is a preference: shown when
    // the settled pair has that colour, silently ignored otherwise. It never
    // changes the pair and the address is never rewritten.
    const colour = colourFromQuery(window.location.search)
    if (colour) {
      setColourPref(colour)
      const id = matrix.variantIdByPair[pairKey(at.caseType, at.device)]
      if (colourView.optionsFor(id).some((option, i) => i > 0 && option[0] === colour)) loadColours(id)
    }
    if (!pick) return
    setCaseType(pick.caseType)
    setDevice(pick.device)
  }, [])

  const selectedId = matrix.variantIdByPair[pairKey(caseType, device)]
  const selected = (selectedId && variantById.get(selectedId)) || null

  // A variant the shopper switches to after that ViewContent gets one more
  // once it has stayed picked for 1.5 s, at most 3 per mount, not primary.
  useEffect(() => {
    const seen = viewed.current
    if (!seen || !selectedId || selectedId === seen.id || seen.n >= 3) return
    const timer = setTimeout(() => {
      if (trackView(caseType, device, false)) {
        seen.id = selectedId
        seen.n++
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [selectedId])

  // Once a shopper's model or case switch settles, load that pair's extra
  // colours when the page does not carry them. Nothing loads on page load.
  useEffect(() => {
    if (!switched.current || !colourView.optionsFor(selectedId).length) return
    const timer = setTimeout(() => loadColours(selectedId), 250)
    return () => clearTimeout(timer)
  }, [selectedId])

  const colourOptions = colourView.optionsFor(selectedId)
  const mainColour = colourOptions.length ? colourOptions[0][0] : null
  const wantedColour = settleColour(colourPref, colourOptions.map((option) => option[0]))
  const lazy = lazyColours[selectedId]
  const colourUrls = wantedColour && wantedColour !== mainColour
    ? colourView.inlineGallery(selectedId, wantedColour) || (lazy && lazy !== 1 ? lazy[wantedColour] : undefined)
    : undefined
  // From a model or case switch until its pictures arrive (the 250 ms settle,
  // then the request: lazy is undefined, then 0), the wanted extra colour's dot
  // is pressed and busy and the main pictures stay. A failed load (1), or a
  // loaded payload or inline pictures without that colour, show the main
  // colour: never busy forever. (An inline variant never loads.)
  const colourBusy = !colourUrls && wantedColour !== mainColour && !lazy && !colourView.hasInline(selectedId)
  const shownColour = colourUrls || colourBusy ? wantedColour : mainColour
  const colourControl: PhoneColourControl | null = mainColour ? {
    options: colourOptions,
    value: shownColour,
    busy: colourBusy ? wantedColour : null,
    onSelect: (slug) => {
      setColourPref(slug)
      if (slug !== mainColour) loadColours(selectedId, true)
    },
    onIntent: () => loadColours(selectedId),
  } : null

  /** The variant's own (main colour) pictures. */
  const mainImages = (selected?.metadata?.images as string[] | undefined) ?? NO_IMAGES
  const items: GalleryItem[] = useMemo(() => {
    // A phone colour swaps the pictures only. The item IDs stay
    // `${variant}-${n}`, so the gallery keeps its angle and never remounts.
    const urls = colourUrls || (mainImages.length ? mainImages : fallbackImages)
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
  }, [selected?.id, mainImages, fallbackImages, galleryVideos, caseType, colourUrls])

  // The picture / price a case-type tile shows: that case type at the current
  // device when it fits, otherwise at the case type's own first device. The
  // current case type's tile follows the phone colour.
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
    if (ct === caseType && colourUrls) return colourUrls[0]
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
            // The bag, wishlist and pack picture is the main colour's, which
            // is what the cart line, checkout and order show: nothing flips.
            thumbnail={mainImages[0] || (items[0] ? items[0].url : null)}
            caseType={caseType}
            device={device}
            onSelectCaseType={selectCaseType}
            onSelectDevice={selectDevice}
            imageForCaseType={imageForCaseType}
            priceForCaseType={priceForCaseType}
            phoneColours={colourControl}
            moreDesigns={
              moreDesignItems?.length ? (
                <MoreDesigns
                  items={moreDesignItems}
                  device={device}
                  caseType={caseType}
                  currentName={designName}
                  currentImage={(colourUrls || mainImages)[0] || fallbackImages[0] || null}
                />
              ) : null
            }
            buyBox={buyBox}
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
                fallback={!simple}
              />
            </div>
          </LazyReveal>
        </div>
      ) : null}
    </div>
  )
}
