"use client"

import { useMemo, useState, type ReactNode } from "react"

import ProductBuyBox from "@/components/product-buy-box"
import ProductGallery, { type GalleryItem } from "@/components/product-gallery"
import type { BundleConfig } from "@/lib/bundles"
import type { StoreVariant } from "@/lib/medusa"

/**
 * The two-column top of the product page.
 *
 * Gallery and device picker share the selected variant, because the picture
 * has to follow the device family: on Signature and Alcantara the variants are
 * different objects - a phone case, an AirPods case, a wallet - and showing a
 * phone to somebody buying a wallet would be wrong. Within a family the
 * gallery holds still, which is the case that does not matter.
 */
export default function ProductView({
  variants,
  families,
  imageFamilyByDevice,
  imagesByFamily,
  fallbackImages,
  designName,
  productTitle,
  header,
  moreDesigns,
  caseTypes,
  shipping,
  bundles,
  tabs,
  pairs,
}: {
  variants: StoreVariant[]
  families: Record<string, string>
  /** device name -> image family (phone, airpods, watch, card-wallet, ...) */
  imageFamilyByDevice: Record<string, string>
  /** image family -> ordered URLs */
  imagesByFamily: Record<string, string[]>
  /** Used when a product has no per-family images yet. */
  fallbackImages: string[]
  designName: string
  productTitle: string
  header: ReactNode
  moreDesigns?: ReactNode
  caseTypes?: ReactNode
  shipping?: ReactNode
  bundles?: BundleConfig | null
  tabs: ReactNode
  pairs: ReactNode
}) {
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "")
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0]

  const family = selected ? imageFamilyByDevice[selected.title] : undefined

  const items: GalleryItem[] = useMemo(() => {
    const urls =
      (family && imagesByFamily[family]?.length
        ? imagesByFamily[family]
        : null) ??
      // A family with no shots of its own falls back to the phone set rather
      // than showing nothing.
      (imagesByFamily.phone?.length ? imagesByFamily.phone : fallbackImages)

    return urls.map((url, i) => ({
      // Keyed by family so switching family remounts the gallery on slide 1
      // instead of holding an index that no longer exists.
      id: `${family ?? "default"}-${i}`,
      url,
      video: null,
    }))
  }, [family, imagesByFamily, fallbackImages])

  return (
    <div className="grid gap-[30px] lg:grid-cols-[600px_minmax(0,570px)]">
      <div>
        <ProductGallery
          key={family ?? "default"}
          items={items}
          label={designName}
        />
      </div>

      <div className="lg:sticky lg:top-[50px] lg:self-start">
        {header}

        <div className="mt-3">
          <ProductBuyBox
            variants={variants}
            families={families}
            productTitle={productTitle}
            thumbnail={items[0]?.url ?? null}
            moreDesigns={moreDesigns}
            caseTypes={caseTypes}
            shipping={shipping}
            bundles={bundles}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {tabs}
        {pairs}
      </div>
    </div>
  )
}
