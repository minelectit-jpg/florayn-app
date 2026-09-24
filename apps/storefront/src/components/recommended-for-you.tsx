"use client"

import Link from "@/components/audience-link"
import { useState } from "react"

import DragScroll from "@/components/drag-scroll"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import Price from "@/components/price"
import ProductImage from "@/components/product-image"
import QuickAdd from "@/components/quick-add"

/** The family heading a model sits under in the SELECT MODEL drawer. */
function modelGroup(label: string): string {
  const l = label.toLowerCase()
  if (l.includes("airpods")) return "AirPods"
  if (l.includes("iphone")) return "iPhone"
  if (l.includes("samsung") || l.includes("galaxy")) return "Samsung"
  if (l.includes("pixel")) return "Pixel"
  return "Models"
}

export type RecommendedVariant = {
  image?: string | null
  href?: string
  caseType?: string
  id: string
  /** The model/option shown in the picker, e.g. "AirPods Pro", "iPhone 16". */
  label: string
  price: number | null
}

export type RecommendedItem = {
  id: string
  /** Product name shown on the card (design name, or the product title). */
  name: string
  handle: string
  thumbnail?: string | null
  /** e.g. "AirPods Case", "Card Holder" — what form this accessory is. */
  formLabel: string
  /** Lowest variant price, shown before a model is chosen. */
  price: number | null
  /** Selectable models; the card shows a picker when there is more than one. */
  variants: RecommendedVariant[]
}

// Image slots for the rail: half the phone width (one card stays that size,
// on the left, rather than filling the screen), the fixed 230px column from
// tablets up.
const CARD_SIZES = "(max-width: 767px) calc(50vw - 20px), 230px"

/**
 * One recommended accessory, dressed as the shop's product card (the same
 * .fl-card markup as product-card.tsx - keep the two in step). One `selected`
 * variant drives the picture, price, link and the item Quick Add puts in the
 * bag, so a model change updates all four together. The link is a stretched
 * sibling of the buttons, never their parent.
 */
function RecommendedCard({ item, sizes }: { item: RecommendedItem; sizes: string }) {
  const [variantId, setVariantId] = useState(item.variants[0]?.id ?? "")
  const [openModel, setOpenModel] = useState(false)

  const selected =
    item.variants.find((v) => v.id === variantId) ?? item.variants[0] ?? null
  const price = selected?.price ?? item.price
  const image = selected?.image ?? null
  const href = selected?.href ?? `/product/${item.handle}/`
  // A single fixed option still says which one it is (e.g. an owner-picked
  // "Signature / iPhone 17 Pro Max"); with a picker the picker says it.
  const detail =
    item.variants.length > 1
      ? selected?.caseType ?? null
      : selected?.label && selected.label !== item.formLabel
        ? selected.label
        : null

  const modelItems: ModelItem[] = item.variants.map((v) => ({
    value: v.id,
    label: v.label,
    group: modelGroup(v.label),
  }))

  return (
    <article className="fl-card group">
      <div className="fl-card__media">
        <ProductImage
          src={image}
          alt={item.name}
          label={item.name}
          sizes={sizes}
          className="fl-card__img"
          fillMode="absolute"
        />
      </div>

      <div className="fl-card__summary">
        <div className="fl-card__titles">
          <h3 className="fl-card__title">{item.name}</h3>
          <p className="fl-card__meta">
            <span>{item.formLabel}</span>
            {detail ? (
              <>
                <span className="fl-card__meta-separator" aria-hidden="true"> • </span>
                <span className="fl-card__case-type">{detail}</span>
              </>
            ) : null}
          </p>
        </div>

        {item.variants.length > 1 ? (
          <button
            type="button"
            className="fl-card__model"
            aria-haspopup="dialog"
            aria-label={`Model: ${selected?.label ?? "Select model"}. Change model`}
            onClick={() => setOpenModel(true)}
          >
            <span>{selected?.label ?? "Select model"}</span>
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
              <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}

        <div className="fl-card__price-row">
          <span className="fl-card__price">
            {price != null ? <Price amount={price} /> : "-"}
          </span>
          <QuickAdd
            key={selected?.id}
            variantId={selected?.id ?? null}
            productTitle={item.name}
            variantTitle={[selected?.caseType, selected?.label].filter(Boolean).join(" / ")}
            unitPrice={price ?? 0}
            thumbnail={image}
          />
        </div>
      </div>

      <Link
        href={href}
        aria-label={`${item.name}, ${item.formLabel}${selected ? `, ${selected.label}` : ""}`}
        className="absolute inset-0 z-[1]"
        prefetch={false}
      />

      {item.variants.length > 1 ? (
        <ModelDrawer
          open={openModel}
          onOpenChange={setOpenModel}
          items={modelItems}
          current={variantId}
          onSelect={(id) => {
            setVariantId(id)
            setOpenModel(false)
          }}
        />
      ) : null}
    </article>
  )
}

/**
 * "Recommended for you" — matching accessories in the same design (the AirPods
 * case, card holder… printed with the same artwork), as shop cards: one big
 * card when there is one, two to a phone screen and swipeable when there are
 * more.
 */
export default function RecommendedForYou({
  items,
  title = "Recommended for you",
}: {
  items: RecommendedItem[]
  title?: string
}) {
  if (!items.length) return null

  return (
    <section>
      <div className="fl-pdp-strip__head">
        <span aria-hidden="true" />
        <h2>{title}</h2>
        <span aria-hidden="true" />
      </div>

      <DragScroll className="fl-pdp-rail" aria-label={title} indicator>
        {items.map((item, i) => (
          <li key={`${item.id}-${i}`}>
            <RecommendedCard item={item} sizes={CARD_SIZES} />
          </li>
        ))}
      </DragScroll>
    </section>
  )
}
