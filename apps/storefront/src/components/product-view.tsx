"use client"

import Link from "next/link"
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
  caseTypeName,
  collection,
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
  /**
   * The heading is built here from plain values rather than passed in as JSX.
   * Static JSX children lose their static marker crossing the server/client
   * boundary, so React sees a keyless array and warns.
   */
  caseTypeName?: string | null
  collection?: { title: string; handle: string } | null
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

  /*
   * The gallery follows the device, not the family: picking iPhone 12 shows
   * the iPhone 12 render. Each variant carries its own shots in metadata;
   * the family map is the fallback for anything not yet wired that way.
   */
  const perVariant = (selected?.metadata?.images as string[] | undefined) ?? []

  const items: GalleryItem[] = useMemo(() => {
    const urls =
      (perVariant.length ? perVariant : null) ??
      (family && imagesByFamily[family]?.length ? imagesByFamily[family] : null) ??
      (imagesByFamily.phone?.length ? imagesByFamily.phone : fallbackImages)

    return urls.map((url, i) => ({
      // Keyed by device so changing device remounts the gallery on slide 1
      // rather than holding an index that no longer exists.
      id: `${selected?.id ?? family ?? "default"}-${i}`,
      url,
      video: null,
    }))
  }, [perVariant, family, imagesByFamily, fallbackImages, selected?.id])

  return (
    <div className="grid gap-[30px] lg:grid-cols-[600px_minmax(0,570px)]">
      <div>
        <ProductGallery
          key={selected?.id ?? family ?? "default"}
          items={items}
          label={designName}
        />
      </div>

      <div className="lg:sticky lg:top-[50px] lg:self-start">
        {collection ? (
          <Link
            href={`/collection/${collection.handle}/`}
            className="eyebrow transition-colors hover:text-purple"
          >
            {collection.title}
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
