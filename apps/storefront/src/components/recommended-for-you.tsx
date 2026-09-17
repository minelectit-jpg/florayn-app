"use client"

import Link from "next/link"
import { useState } from "react"

import { useCart } from "@/components/cart-provider"
import DragScroll from "@/components/drag-scroll"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import Price from "@/components/price"
import ProductImage from "@/components/product-image"

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

/**
 * One recommended accessory. The shopper picks a model (when the product has
 * more than one) and adds it; adding opens the cart drawer, so the whole flow
 * stays on the product page.
 */
function RecommendedCard({ item }: { item: RecommendedItem }) {
  const { add } = useCart()
  const [variantId, setVariantId] = useState(item.variants[0]?.id ?? "")
  const [openModel, setOpenModel] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected =
    item.variants.find((v) => v.id === variantId) ?? item.variants[0] ?? null
  const price = selected?.price ?? item.price

  const modelItems: ModelItem[] = item.variants.map((v) => ({
    value: v.id,
    label: v.label,
    group: modelGroup(v.label),
  }))

  async function addToCart() {
    if (!selected || busy) return
    setBusy(true)
    try {
      // add() opens the cart drawer by default.
      await add(selected.id, 1, {
        productTitle: item.name,
        variantTitle: selected.label,
        unitPrice: selected.price ?? item.price ?? 0,
        thumbnail: item.thumbnail ?? null,
      })
    } catch {
      /* the provider rolls the optimistic add back on failure */
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="flex h-full flex-col rounded-[12px] border border-line p-3">
      <Link
        href={`/product/${item.handle}/`}
        className="block"
        aria-label={`${item.name}, ${item.formLabel}`}
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-[8px] bg-surface">
          <ProductImage
            src={item.thumbnail}
            alt={item.name}
            label={item.name}
            sizes="240px"
            fillMode="absolute"
          />
        </div>
      </Link>

      <div className="mt-3 flex flex-1 flex-col text-center">
        <Link href={`/product/${item.handle}/`} className="block">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
            {item.name}
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-muted">{item.formLabel}</p>
        </Link>

        <p className="mt-1 text-[15px] font-semibold tabular-nums">
          {price != null ? <Price amount={price} /> : "—"}
        </p>

        {item.variants.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setOpenModel(true)}
              aria-haspopup="dialog"
              className="mt-3 flex h-11 w-full items-center justify-between rounded-[8px] border border-[#e2e2e2] bg-paper px-3 text-left text-[13px] transition-colors hover:border-line-strong focus:border-purple focus:outline-none"
            >
              <span className="truncate">{selected?.label ?? "Select model"}</span>
              <svg
                width="13"
                height="13"
                viewBox="0 0 14 14"
                aria-hidden="true"
                className="ml-2 shrink-0"
              >
                <path
                  d="M3 5l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>

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
          </>
        ) : null}

        <button
          type="button"
          onClick={addToCart}
          disabled={busy || !selected}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-full border border-ink text-[13px] font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add to cart"}
        </button>
      </div>
    </article>
  )
}

/**
 * "Recommended for you" — matching accessories in the same design (the AirPods
 * case, card holder, ring holder… printed with the same artwork). A centered,
 * BURGA-style heading over a horizontal slider of cards.
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
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <h2 className="text-center text-[1.05rem] font-semibold uppercase tracking-[0.04em]">
          {title}
        </h2>
        <span className="h-px flex-1 bg-line" />
      </div>

      <DragScroll className="mt-5 flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {items.map((item) => (
          <li
            key={item.id}
            className="w-[210px] shrink-0 snap-start sm:w-[230px]"
          >
            <RecommendedCard item={item} />
          </li>
        ))}
      </DragScroll>
    </section>
  )
}
