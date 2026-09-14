"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import ProductImage from "@/components/product-image"
import { Spinner } from "@/components/ui/button"
import { useCart } from "@/components/cart-provider"
import type { StoreVariant } from "@/lib/medusa"
import { formatPrice } from "@/lib/money"
import { pairKey, type VariantMatrix } from "@/lib/variant-matrix"

type AddState = "idle" | "adding" | "added" | "error"

/**
 * The right-hand column of the product page, from the price down. Owns the two
 * linked selectors (Case Type tiles + Device drawer) and the add-to-cart form.
 * Selection state lives in the parent so the gallery can follow it; this only
 * renders the controls and reports changes back.
 */
export default function ProductBuyBox({
  matrix,
  selected,
  families,
  stock,
  productTitle,
  thumbnail,
  caseType,
  device,
  onSelectCaseType,
  onSelectDevice,
  imageForCaseType,
  priceForCaseType,
  moreDesigns,
  shipping,
}: {
  matrix: VariantMatrix
  /** The variant for the current (caseType, device) pair, or null. */
  selected: StoreVariant | null
  /** device name -> family label, for grouping the drawer. */
  families: Record<string, string>
  /** "<Case Type>|<Device>" -> available quantity (shared blank stock). */
  stock: Record<string, number>
  productTitle: string
  thumbnail: string | null
  caseType: string
  device: string
  onSelectCaseType: (caseType: string) => void
  onSelectDevice: (device: string) => void
  imageForCaseType: (caseType: string) => string | null
  priceForCaseType: (caseType: string) => number | null
  moreDesigns?: ReactNode
  shipping?: ReactNode
}) {
  const { add } = useCart()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [qty, setQty] = useState(1)
  const [state, setState] = useState<AddState>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  const price = selected?.calculated_price

  // The product page is cached (ISR), so its baked stock can be stale. Refresh
  // the shared blank availability client-side on mount so sold-out is current
  // and we do not oversell.
  const [liveStock, setLiveStock] = useState(stock)
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    const key = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    if (!base || !key) return
    fetch(`${base}/store/stock`, { headers: { "x-publishable-api-key": key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.stock) setLiveStock(d.stock)
      })
      .catch(() => {})
  }, [])

  // Shared blank availability. A missing key means the pair is outside the blank
  // system (e.g. a stock not tracked), so treat it as available.
  const availableFor = (ct: string, dev: string) =>
    liveStock[`${ct}|${dev}`] ?? Infinity
  const selectedOut = availableFor(caseType, device) <= 0

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

  // Devices available for the selected case type, grouped by family for the
  // drawer. Switching case type changes this list.
  const availableDevices = matrix.devicesByCaseType[caseType] ?? []
  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const groups = new Map<string, string[]>()
    for (const d of availableDevices) {
      if (needle && !d.toLowerCase().includes(needle)) continue
      const label = families[d] ?? "Other"
      const bucket = groups.get(label) ?? []
      bucket.push(d)
      groups.set(label, bucket)
    }
    return [...groups.entries()]
  }, [availableDevices, families, query])

  const matchCount = grouped.reduce((sum, [, list]) => sum + list.length, 0)

  async function onAdd() {
    if (!selected || state === "adding") return
    setState("adding")
    try {
      await add(selected.id, qty, {
        productTitle,
        variantTitle: `${caseType} / ${device}`,
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

  const cta = selectedOut
    ? "Sold out"
    : {
        idle: "Add to cart",
        adding: "Adding...",
        added: "Added",
        error: "Try again",
      }[state]

  return (
    <div>
      {/* Price - the selected variant's, 26px/600 to match the title. */}
      <p className="text-[1.625rem] font-semibold leading-none tracking-[-0.034em] tabular-nums">
        {formatPrice(price?.calculated_amount, price?.currency_code)}
      </p>

      {/* CASE TYPE - in-page tiles. A case type not sold for the selected
          device is disabled rather than hidden, so the range stays visible. */}
      {matrix.caseTypes.length > 1 ? (
        <section className="mt-5">
          <p className="fl-pdp-label">CASE TYPE</p>
          <ul className="flex flex-wrap gap-[10px]">
            {matrix.caseTypes.map((ct) => {
              const fits = (matrix.caseTypesByDevice[device] ?? []).includes(ct)
              const isCurrent = ct === caseType
              const soldOut = fits && availableFor(ct, device) <= 0
              const img = imageForCaseType(ct)
              const ctPrice = priceForCaseType(ct)
              return (
                <li key={ct}>
                  <button
                    type="button"
                    onClick={() => onSelectCaseType(ct)}
                    aria-pressed={isCurrent}
                    disabled={!fits && !isCurrent}
                    title={!fits ? `${ct} is not made for ${device}` : ct}
                    className={[
                      "flex h-[205px] w-[135px] flex-col overflow-hidden rounded-[10px] border bg-surface text-left transition-colors",
                      isCurrent
                        ? "border-purple"
                        : "border-[#e2e2e2] hover:border-purple",
                      (!fits && !isCurrent) || soldOut ? "opacity-40" : "",
                    ].join(" ")}
                  >
                    <span className="relative block h-[150px] w-full overflow-hidden rounded-t-[9px]">
                      <ProductImage
                        src={img}
                        alt={ct}
                        label={ct}
                        sizes="135px"
                      />
                    </span>
                    <span className="block px-2 py-2 text-center">
                      <span className="block text-[13px] font-semibold leading-tight">
                        {ct}
                      </span>
                      <span className="mt-0.5 block text-[13px] tabular-nums text-ink-muted">
                        {soldOut
                          ? "Sold out"
                          : ctPrice != null
                            ? formatPrice(ctPrice)
                            : null}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

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
            <span>{device || "Select a device"}</span>
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
                placeholder={`Search ${availableDevices.length} devices`}
                className="field-input mb-3"
              />
              <div role="listbox" className="max-h-72 space-y-4 overflow-y-auto pr-1">
                {matchCount === 0 ? (
                  <p className="px-1 py-6 text-sm text-ink-muted">
                    No device matches &ldquo;{query}&rdquo;.
                  </p>
                ) : (
                  grouped.map(([familyLabel, list]) => (
                    <div key={familyLabel}>
                      <p className="eyebrow px-1 pb-2">{familyLabel}</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {list.map((d) => {
                          const isSelected = d === device
                          const dOut = availableFor(caseType, d) <= 0
                          return (
                            <button
                              key={d}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => {
                                onSelectDevice(d)
                                setOpen(false)
                                setQuery("")
                                setState("idle")
                              }}
                              className={[
                                "flex items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-left text-sm transition-colors",
                                isSelected
                                  ? "border-purple bg-purple-tint text-ink"
                                  : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                                dOut ? "opacity-45" : "",
                              ].join(" ")}
                            >
                              <span>{d}</span>
                              {dOut ? (
                                <span className="text-[11px] text-ink-faint">
                                  Sold out
                                </span>
                              ) : null}
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

      {/* Quantity + add to cart. */}
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
          disabled={!selected || selectedOut || state === "adding"}
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
            ? `${caseType} ${device} added to cart`
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
