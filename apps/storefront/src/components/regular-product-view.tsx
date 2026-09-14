"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"

import ProductGallery, { type GalleryItem } from "@/components/product-gallery"
import { Spinner } from "@/components/ui/button"
import { useCart } from "@/components/cart-provider"
import type { StoreProduct, StoreVariant } from "@/lib/medusa"
import { formatPrice } from "@/lib/money"

type AddState = "idle" | "adding" | "added" | "error"

/**
 * A plain product page for anything that is NOT the design x case type x device
 * catalogue - a manually-created "regular" product (a popsocket, a gift card, a
 * one-off). It renders whatever options the product has as simple pickers, or
 * just a single variant, so the store owner can add normal products freely.
 */
export default function RegularProductView({
  product,
  collection,
  tabs,
}: {
  product: StoreProduct
  collection?: { title: string; handle: string } | null
  tabs?: ReactNode
}) {
  const { add } = useCart()
  const variants = product.variants ?? []
  const options = product.options ?? []

  const optionTitleById = useMemo(
    () => new Map(options.map((o) => [o.id, o.title])),
    [options]
  )

  // Read a variant's value for each option title.
  function valuesOf(v: StoreVariant): Record<string, string> {
    const out: Record<string, string> = {}
    for (const ov of v.options ?? []) {
      const title = optionTitleById.get(ov.option_id)
      if (title) out[title] = ov.value
    }
    return out
  }

  const [selection, setSelection] = useState<Record<string, string>>(() =>
    variants[0] ? valuesOf(variants[0]) : {}
  )

  const selected =
    variants.find((v) => {
      const vals = valuesOf(v)
      return options.every((o) => vals[o.title] === selection[o.title])
    }) ??
    variants[0] ??
    null

  const [qty, setQty] = useState(1)
  const [state, setState] = useState<AddState>("idle")

  const price = selected?.calculated_price
  const images = useMemo<GalleryItem[]>(() => {
    const perVariant = (selected?.metadata?.images as string[] | undefined) ?? []
    const urls = perVariant.length
      ? perVariant
      : (product.images ?? []).map((i) => i.url)
    return urls.map((url, i) => ({ id: `${selected?.id ?? "d"}-${i}`, url, video: null }))
  }, [selected?.id, selected?.metadata, product.images])

  async function onAdd() {
    if (!selected || state === "adding") return
    setState("adding")
    try {
      await add(selected.id, qty, {
        productTitle: product.title,
        variantTitle: selected.title,
        unitPrice: price?.calculated_amount ?? 0,
        thumbnail: images[0]?.url ?? null,
      })
      setState("added")
    } catch {
      setState("error")
    }
    setTimeout(() => setState("idle"), 2500)
  }

  const cta = { idle: "Add to cart", adding: "Adding...", added: "Added", error: "Try again" }[state]
  // Only show pickers for options that genuinely vary (a single default option
  // named "Default option" from Medusa is noise).
  const shownOptions = options.filter(
    (o) => (o.values ?? []).length > 1 && o.title !== "Default option"
  )

  return (
    <div className="grid gap-[30px] lg:grid-cols-[600px_minmax(0,570px)]">
      <div>
        <ProductGallery key={selected?.id ?? "default"} items={images} label={product.title} />
      </div>

      <div className="lg:sticky lg:top-[50px] lg:self-start">
        {collection ? (
          <Link href={`/collection/${collection.handle}/`} className="eyebrow transition-colors hover:text-purple">
            {collection.title}
          </Link>
        ) : null}

        <h1 className="mt-2 text-[1.625rem] font-semibold leading-tight tracking-[-0.034em]">
          {product.title}
        </h1>
        {product.subtitle ? (
          <p className="mt-1 text-ink-muted">{product.subtitle}</p>
        ) : null}

        <p className="mt-3 text-[1.625rem] font-semibold leading-none tracking-[-0.034em] tabular-nums">
          {formatPrice(price?.calculated_amount, price?.currency_code)}
        </p>

        {shownOptions.map((option) => (
          <div key={option.id} className="mt-6">
            <p className="fl-pdp-label">{option.title.toUpperCase()}</p>
            <div className="flex flex-wrap gap-2">
              {(option.values ?? []).map((val) => {
                const active = selection[option.title] === val.value
                return (
                  <button
                    key={val.id}
                    type="button"
                    onClick={() =>
                      setSelection((s) => ({ ...s, [option.title]: val.value }))
                    }
                    className={[
                      "rounded-[10px] border px-4 py-2 text-sm transition-colors",
                      active
                        ? "border-purple bg-purple-tint text-ink"
                        : "border-[#e2e2e2] text-ink-muted hover:border-purple",
                    ].join(" ")}
                  >
                    {val.value}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="mt-7 flex items-stretch gap-3">
          <div className="flex h-[50px] items-center rounded-[30px] border border-line">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              aria-label="Decrease quantity"
              className="grid size-[38px] place-items-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              &minus;
            </button>
            <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(99, q + 1))}
              disabled={qty >= 99}
              aria-label="Increase quantity"
              className="grid size-[38px] place-items-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={onAdd}
            disabled={!selected || state === "adding"}
            className={[
              "flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[30px] px-6 text-[15px] font-semibold transition-colors",
              state === "error" ? "border border-danger text-danger" : "bg-ink text-white hover:bg-purple",
              "disabled:opacity-60",
            ].join(" ")}
          >
            {state === "adding" ? <Spinner /> : null}
            {cta}
          </button>
        </div>

        {product.description ? (
          <p className="mt-6 max-w-prose whitespace-pre-line text-sm leading-relaxed text-ink-muted">
            {product.description}
          </p>
        ) : null}

        {tabs}
      </div>
    </div>
  )
}
