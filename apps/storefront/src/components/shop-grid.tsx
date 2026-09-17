"use client"

import { useMemo, useRef, useState } from "react"

import ProductCard from "@/components/product-card"
import type { StoreProduct } from "@/lib/medusa"
import { priceRange } from "@/lib/money"

type SortKey = "featured" | "newest" | "price-asc" | "price-desc"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "newest", label: "Newest" },
  { key: "price-asc", label: "Price: Low to High" },
  { key: "price-desc", label: "Price: High to Low" },
]

function minPrice(p: StoreProduct): number {
  return priceRange(p.variants ?? [])?.min ?? Number.POSITIVE_INFINITY
}

export default function ShopGrid({
  products,
  device,
  deviceSlug,
  caseType,
  caseTypeSlug,
}: {
  products: StoreProduct[]
  device?: string | null
  deviceSlug?: string | null
  caseType?: string | null
  caseTypeSlug?: string | null
}) {
  const [sort, setSort] = useState<SortKey>("featured")
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => {
    const list = [...products]
    switch (sort) {
      case "newest":
        return list.sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() -
            new Date(a.created_at ?? 0).getTime()
        )
      case "price-asc":
        return list.sort((a, b) => minPrice(a) - minPrice(b))
      case "price-desc":
        return list.sort((a, b) => minPrice(b) - minPrice(a))
      default:
        return list
    }
  }, [products, sort])

  const activeLabel = SORTS.find((s) => s.key === sort)?.label ?? "Featured"

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">
          {products.length} {products.length === 1 ? "design" : "designs"}
        </p>

        <div
          ref={boxRef}
          className="relative"
          onBlur={(e) => {
            if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
          }}
        >
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex min-w-[160px] items-center justify-between gap-3 rounded-[10px] border border-line bg-paper px-4 py-2.5 text-sm transition-colors hover:border-line-strong"
          >
            <span>{activeLabel}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            >
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {open ? (
            <ul
              role="listbox"
              className="absolute right-0 z-30 mt-2 min-w-[220px] overflow-hidden rounded-[12px] border border-line bg-paper py-1 shadow-[0_18px_40px_-12px_rgba(26,22,37,0.28)]"
            >
              {SORTS.map((s) => {
                const isActive = s.key === sort
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        setSort(s.key)
                        setOpen(false)
                      }}
                      className={`block w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface ${
                        isActive ? "font-semibold text-purple" : "text-ink"
                      }`}
                    >
                      {s.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="fl-grid">
        {sorted.map((product, i) => (
          <ProductCard
            key={product.id}
            product={product}
            device={device ?? null}
            deviceSlug={deviceSlug ?? null}
            caseType={caseType ?? null}
            caseTypeSlug={caseTypeSlug ?? null}
            // The first two rows are above the fold; load their images eagerly
            // so the grid fills in at once instead of after a lazy-load delay.
            priority={i < 6}
          />
        ))}
      </div>
    </div>
  )
}
