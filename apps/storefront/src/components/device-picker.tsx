"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { useCart } from "@/components/cart-provider"
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
    added: "Added ✓",
    error: "Try again",
  }[state]

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <label
            htmlFor="device-search"
            className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]"
          >
            Choose your device
          </label>
          <span className="text-xs text-[var(--color-ink-soft)]">
            {variants.length} available
          </span>
        </div>
        <input
          id="device-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search iPhone 15 Pro, Galaxy S24, AirPods..."
          className="mt-2 w-full border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
        />
      </div>

      <div className="max-h-80 space-y-4 overflow-y-auto border border-[var(--color-line)] bg-white p-3">
        {matchCount === 0 ? (
          <p className="px-1 py-4 text-sm text-[var(--color-ink-soft)]">
            No device matches &ldquo;{query}&rdquo;. This case type may not be
            made for it.
          </p>
        ) : (
          grouped.map(([familyLabel, list]) => (
            <div key={familyLabel}>
              <p className="px-1 pb-1 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                {familyLabel}
              </p>
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
                        "flex items-center justify-between gap-2 border px-3 py-2 text-left text-sm",
                        isSelected
                          ? "border-[var(--color-ink)] bg-[var(--color-paper)]"
                          : "border-transparent hover:border-[var(--color-line)]",
                      ].join(" ")}
                    >
                      <span>{variant.title}</span>
                      <span className="shrink-0 text-[var(--color-ink-soft)]">
                        {formatPrice(
                          variant.calculated_price?.calculated_amount,
                          variant.calculated_price?.currency_code
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-[var(--color-line)] pt-5">
        <div>
          <p className="display text-2xl">
            {formatPrice(
              selected?.calculated_price?.calculated_amount,
              selected?.calculated_price?.currency_code
            )}
          </p>
          <p className="text-xs text-[var(--color-ink-soft)]">
            {selected ? selected.title : "Select a device"}
            {selected?.sku ? ` - ${selected.sku}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={!selected || state === "adding"}
          className={[
            "ml-auto flex items-center gap-2 px-6 py-3 text-sm text-white transition-colors",
            state === "error"
              ? "bg-red-700"
              : state === "added"
                ? "bg-green-800"
                : "bg-[var(--color-ink)]",
            state === "adding" ? "opacity-70" : "",
            !selected ? "opacity-50" : "",
          ].join(" ")}
        >
          {state === "adding" ? (
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
            />
          ) : null}
          {label}
        </button>
      </div>

      {/* Announced to screen readers, which never see the drawer animation. */}
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
        <p className="text-sm text-red-700">
          Could not add that to your cart. Check your connection and try again.
        </p>
      ) : null}
    </div>
  )
}
