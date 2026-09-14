"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"

import ProductBuyBox from "@/components/product-buy-box"
import ProductGallery, { type GalleryItem } from "@/components/product-gallery"
import type { StoreVariant } from "@/lib/medusa"
import { pairKey, type VariantMatrix } from "@/lib/variant-matrix"

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
  productTitle,
  collection,
  deviceName,
  initialCaseType,
  initialDevice,
  fitCopy,
  moreDesigns,
  shipping,
  tabs,
  pairs,
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
  productTitle: string
  collection?: { title: string; handle: string } | null
  /** Set on a device page: the device this URL is for (drives the H1). */
  deviceName?: string | null
  initialCaseType: string
  initialDevice: string
  fitCopy?: string | null
  moreDesigns?: ReactNode
  shipping?: ReactNode
  tabs: ReactNode
  pairs: ReactNode
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

  const selectedId = matrix.variantIdByPair[pairKey(caseType, device)]
  const selected = (selectedId && variantById.get(selectedId)) || null

  const items: GalleryItem[] = useMemo(() => {
    const imgs = (selected?.metadata?.images as string[] | undefined) ?? []
    const urls = imgs.length ? imgs : fallbackImages
    return urls.map((url, i) => ({
      id: `${selected?.id ?? "default"}-${i}`,
      url,
      video: null,
    }))
  }, [selected?.id, selected?.metadata, fallbackImages])

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
    <div className="grid gap-[30px] lg:grid-cols-[600px_minmax(0,570px)]">
      <div>
        <ProductGallery
          key={selected?.id ?? "default"}
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
          {deviceName ? `${designName} ${deviceName} Case` : designName}
          <span className="text-ink-muted"> &ndash; {caseType}</span>
        </h1>

        {fitCopy ? (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
            {fitCopy}
          </p>
        ) : null}

        <div className="mt-3">
          <ProductBuyBox
            matrix={matrix}
            selected={selected}
            families={families}
            stock={stock}
            productTitle={productTitle}
            thumbnail={items[0]?.url ?? null}
            caseType={caseType}
            device={device}
            onSelectCaseType={selectCaseType}
            onSelectDevice={selectDevice}
            imageForCaseType={imageForCaseType}
            priceForCaseType={priceForCaseType}
            moreDesigns={moreDesigns}
            shipping={shipping}
          />
        </div>

        {tabs}
        {pairs}
      </div>
    </div>
  )
}
