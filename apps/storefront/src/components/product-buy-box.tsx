"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { useCart } from "@/components/cart-provider"
import { Spinner } from "@/components/ui/button"
import type { StoreVariant } from "@/lib/medusa"
import { formatPrice } from "@/lib/money"

type AddState = "idle" | "adding" | "added" | "error"

/**
 * The right-hand column of the product page, from the price down.
 *
 * On the live site the device picker and the add-to-cart form are separated by
 * the MORE DESIGNS and CASE TYPE blocks, but they share the selected device -
 * so those two blocks are passed in as slots rather than rendered as siblings.
 */
export default function ProductBuyBox({
  variants,
  families,
  productTitle,
  thumbnail,
  moreDesigns,
  caseTypes,
  shipping,
}: {
  variants: StoreVariant[]
  /** device name -> family label, for grouping the drawer. */
  families: Record<string, string>
  productTitle: string
  thumbnail: string | null
  moreDesigns?: ReactNode
  caseTypes?: ReactNode
  shipping?: ReactNode
}) {
  const { add } = useCart()
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "")
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [qty, setQty] = useState(1)
  const [state, setState] = useState<AddState>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  const selected = variants.find((v) => v.id === selectedId)
  const price = selected?.calculated_price

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  // Close the drawer on Escape or a click outside it.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    function onClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClick)
    }
  }, [open])

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const groups = new Map<string, StoreVariant[]>()
    for (const variant of variants) {
      if (needle && !variant.title.toLowerCase().includes(needle)) continue
      const label = families[variant.title] ?? "Other"
      const bucket = groups.get(label) ?? []
      bucket.push(variant)
      groups.set(label, bucket)
    }
    return [...groups.entries()]
  }, [variants, families, query])

  const matchCount = grouped.reduce((sum, [, list]) => sum + list.length, 0)

  async function onAdd() {
    if (!selected || state === "adding") return
    setState("adding")
    try {
      await add(selected.id, qty, {
        productTitle,
        variantTitle: selected.title,
        unitPrice: price?.calculated_amount ?? 0,
        thumbnail,
      })
      setState("added")
    } catch {
      setState("error")
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setState("idle"), 2500)
  }

  const cta = {
    idle: "Add to cart",
    adding: "Adding...",
    added: "Added",
    error: "Try again",
  }[state]

  return (
    <div>
      {/* Price. 26px/600 on the live page, the same size as the title. */}
      <p className="text-[1.625rem] font-semibold leading-none tracking-[-0.034em] tabular-nums">
        {formatPrice(price?.calculated_amount, price?.currency_code)}
      </p>

      <BundleTiers unit={price?.calculated_amount ?? null} />

      {/* DEVICE */}
      <div className="mt-6">
        <p className="fl-pdp-label">DEVICE</p>
        <div ref={drawerRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="flex h-[52px] w-full items-center justify-between rounded-[12px] border border-[#e2e2e2] bg-surface px-4 text-left text-base transition-colors hover:border-line-strong focus:border-purple focus:outline-none"
          >
            <span>{selected ? selected.title : "Select a device"}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              aria-hidden="true"
              className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
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

          {open ? (
            <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-[12px] border border-line bg-surface p-3 shadow-[0_18px_34px_-18px_rgba(26,22,37,0.28)]">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${variants.length} devices`}
                className="field-input mb-3"
              />
              <div
                role="listbox"
                className="max-h-72 space-y-4 overflow-y-auto pr-1"
              >
                {matchCount === 0 ? (
                  <p className="px-1 py-6 text-sm text-ink-muted">
                    No device matches &ldquo;{query}&rdquo;. This case type may
                    not be made for it.
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
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => {
                                setSelectedId(variant.id)
                                setState("idle")
                                setOpen(false)
                                setQuery("")
                              }}
                              className={[
                                "rounded-[8px] border px-3 py-2 text-left text-sm transition-colors",
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
            </div>
          ) : null}
        </div>
      </div>

      {moreDesigns}
      {caseTypes}

      {/* Quantity + add to cart. Live: 50px tall pill, full width beside qty. */}
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
          <span aria-live="polite" className="w-6 text-center text-sm tabular-nums">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(10, q + 1))}
            disabled={qty >= 10}
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
            state === "error"
              ? "border border-danger text-danger"
              : "bg-ink text-white hover:bg-purple",
            "disabled:opacity-60",
          ].join(" ")}
        >
          {state === "adding" ? <Spinner /> : null}
          {cta}
          {state === "added" ? (
            <span aria-hidden="true" className="text-base leading-none">
              &#10003;
            </span>
          ) : null}
        </button>
      </div>

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
        <p className="mt-3 text-sm text-danger">
          Could not add that to your cart. Check your connection and try again.
        </p>
      ) : null}

      {shipping}
    </div>
  )
}

/**
 * The live page sells single / 2-pack / 3-pack / matching-set tiers from its
 * bundle-offers module. The tier prices are configured per product there and
 * are not exposed read-only, so only the Single tier carries a real figure -
 * the rest are marked pending rather than filled with invented discounts.
 */
function BundleTiers({ unit }: { unit: number | null }) {
  const tiers = [
    { key: "single", label: "Single", qty: 1 },
    { key: "two", label: "2-pack", qty: 2 },
    { key: "three", label: "3-pack", qty: 3 },
  ]

  return (
    <div className="mt-5 grid grid-cols-3 gap-1">
      {tiers.map((tier, i) => {
        const isSingle = i === 0
        return (
          <div
            key={tier.key}
            aria-current={isSingle}
            className={[
              "rounded-[11px] border px-3 py-2.5 text-center",
              isSingle
                ? "border-purple bg-purple-tint"
                : "border-[#ddd0fb] bg-surface",
            ].join(" ")}
          >
            <p className="text-[13px] font-semibold">{tier.label}</p>
            <p className="mt-0.5 text-[13px] tabular-nums">
              {isSingle && unit != null ? (
                formatPrice(unit)
              ) : (
                <span className="text-ink-faint">&mdash;</span>
              )}
            </p>
          </div>
        )
      })}
    </div>
  )
}
