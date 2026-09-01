"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { useCart } from "@/components/cart-provider"
import { Button, Spinner } from "@/components/ui/button"
import type { StoreVariant } from "@/lib/medusa"
import { formatPrice } from "@/lib/money"

type AddState = "idle" | "adding" | "added" | "error"

/**
 * Every variant of a product is a device, so the variant selector is a device
 * selector. Variants only exist for devices the case type is tooled for, so
 * this list is already the compatibility list - there is nothing to grey out.
 */
export default function DevicePicker({
  variants,
  families,
  productTitle,
  thumbnail,
}: {
  variants: StoreVariant[]
  /** device name -> family label, for grouping the list. */
  families: Record<string, string>
  productTitle: string
  thumbnail: string | null
}) {
  const { add } = useCart()
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "")
  const [query, setQuery] = useState("")
  const [state, setState] = useState<AddState>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = variants.find((v) => v.id === selectedId)

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current)
      }
    }
  }, [])

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const groups = new Map<string, StoreVariant[]>()

    for (const variant of variants) {
      if (needle && !variant.title.toLowerCase().includes(needle)) {
        continue
      }
      const label = families[variant.title] ?? "Other"
      const bucket = groups.get(label) ?? []
      bucket.push(variant)
      groups.set(label, bucket)
    }

    return [...groups.entries()]
  }, [variants, families, query])

  const matchCount = grouped.reduce((sum, [, list]) => sum + list.length, 0)

  function scheduleReset() {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
    }
    resetTimer.current = setTimeout(() => setState("idle"), 2500)
  }

  async function onAdd() {
    if (!selected || state === "adding") {
      return
    }

    setState("adding")
    try {
      await add(selected.id, 1, {
        productTitle,
        variantTitle: selected.title,
        unitPrice: selected.calculated_price?.calculated_amount ?? 0,
        thumbnail,
      })
      setState("added")
    } catch {
      setState("error")
    }
    scheduleReset()
  }

  const label = {
    idle: "Add to cart",
    adding: "Adding...",
    added: "Added",
    error: "Try again",
  }[state]

  // Price is flat per case type, so it belongs beside the title rather than
  // changing as devices are picked.
  const price = selected?.calculated_price

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3 border-y border-line py-4">
        <span className="display text-[1.75rem] leading-none tabular-nums">
          {formatPrice(price?.calculated_amount, price?.currency_code)}
        </span>
        <span className="eyebrow">Any device, one price</span>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor="device-search" className="eyebrow">
            Choose your device
          </label>
          <span className="eyebrow">{variants.length} available</span>
        </div>
        <input
          id="device-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search iPhone 15 Pro, Samsung S25, AirPods..."
          className="field-input mt-2"
        />
      </div>

      <div className="max-h-80 space-y-5 overflow-y-auto border border-line bg-surface p-4">
        {matchCount === 0 ? (
          <p className="px-1 py-6 text-sm text-ink-muted">
            No device matches &ldquo;{query}&rdquo;. This case type may not be
            made for it.
          </p>
        ) : (
          grouped.map(([familyLabel, list]) => (
            <div key={familyLabel}>
              <p className="eyebrow px-1 pb-2">{familyLabel}</p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {list.map((variant) => {
                  const isSelected = variant.id === selectedId
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(variant.id)
                        setState("idle")
                      }}
                      aria-pressed={isSelected}
                      className={[
                        "border px-3 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "border-purple bg-purple-tint text-ink"
                          : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                      ].join(" ")}
                    >
                      {variant.title}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm">
            {selected ? selected.title : "Select a device"}
          </span>
          {selected?.sku ? (
            <span className="eyebrow">{selected.sku}</span>
          ) : null}
        </div>

        <Button
          type="button"
          onClick={onAdd}
          disabled={!selected || state === "adding"}
          size="lg"
          fullWidth
          variant={state === "error" ? "secondary" : "primary"}
          className={state === "error" ? "border-danger text-danger" : ""}
        >
          {state === "adding" ? <Spinner /> : null}
          {label}
          {state === "added" ? (
            <span aria-hidden="true" className="text-base leading-none">
              &#10003;
            </span>
          ) : null}
        </Button>
      </div>

      {/* Announced to screen readers, which never see the drawer animate. */}
      <p role="status" aria-live="polite" className="sr-only">
        {state === "adding"
          ? "Adding to cart"
          : state === "added"
            ? `${selected?.title ?? "Item"} added to cart`
            : state === "error"
              ? "Could not add to cart. Try again."
              : ""}
      </p>

      {state === "error" ? (
        <p className="text-sm text-danger">
          Could not add that to your cart. Check your connection and try again.
        </p>
      ) : null}
    </div>
  )
}
