"use client"

import Link from "next/link"
import { useMemo, useRef, useState, type ReactNode } from "react"

import ProductCard from "@/components/product-card"
import { useShopImageLoading } from "@/components/use-shop-image-loading"
import type { StoreProduct } from "@/lib/medusa"
import { priceRange } from "@/lib/money"
import { SHOP_PRIORITY_IMAGES } from "@/lib/shop-image-loading"

type SortKey = "featured" | "name-asc" | "price-asc" | "price-desc"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "name-asc", label: "Name: A–Z" },
  { key: "price-asc", label: "Price: Low to High" },
  { key: "price-desc", label: "Price: High to Low" },
]

function minPrice(p: StoreProduct): number {
  return priceRange(p.variants ?? [])?.min ?? Number.POSITIVE_INFINITY
}

/** The page numbers to show, with gaps collapsed to a single ellipsis. */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7)
    return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | "…")[] = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(total - 1, current + 1)
  if (from > 2) out.push("…")
  for (let i = from; i <= to; i++) out.push(i)
  if (to < total - 1) out.push("…")
  out.push(total)
  return out
}

export default function ShopGrid({
  products,
  device,
  deviceSlug,
  caseType,
  caseTypeSlug,
  totalCount,
  currentPage = 1,
  totalPages = 1,
  routePath,
  selectors,
}: {
  products: StoreProduct[]
  device?: string | null
  deviceSlug?: string | null
  caseType?: string | null
  caseTypeSlug?: string | null
  /** Total designs across all pages, for the "N designs" count. */
  totalCount?: number
  currentPage?: number
  totalPages?: number
  /** Server-rendered route identity for opt-in image-readiness diagnostics. */
  selectors?: ReactNode
  routePath: string
}) {
  const [sort, setSort] = useState<SortKey>("featured")
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Sort acts on the current page; "Featured" keeps the catalogue order.
  const sorted = useMemo(() => {
    const list = [...products]
    switch (sort) {
      case "name-asc":
        return list.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""))
      case "price-asc":
        return list.sort((a, b) => minPrice(a) - minPrice(b))
      case "price-desc":
        return list.sort((a, b) => minPrice(b) - minPrice(a))
      default:
        return list
    }
  }, [products, sort])

  // Include ordered image identities so model, sort, and updated renders start
  // a fresh bounded batch without remounting every card or resetting Quick Add.
  const imageBatchKey = useMemo(() => JSON.stringify([
    routePath,
  selectors, device, caseType,
    sorted.map((product) => [
      product.id, product.thumbnail, product.images?.map((image) => image.url),
      product.variants?.map((variant) => [variant.id, variant.options, variant.metadata?.images]),
    ]),
  ]), [routePath, device, caseType, sorted])
  const { gridRef, deferred } = useShopImageLoading(imageBatchKey)

  const activeLabel = SORTS.find((s) => s.key === sort)?.label ?? "Featured"
  const count = totalCount ?? products.length

  const base = !deviceSlug
    ? "/shop/"
    : caseTypeSlug
      ? `/shop/${deviceSlug}/${caseTypeSlug}/`
      : `/shop/${deviceSlug}/`
  const hrefFor = (p: number) => (p > 1 ? `${base}${p}/` : base)

  return (
    <div className="space-y-5">
      <div className={selectors ? "fl-shop-toolbar" : "flex justify-end"}>
        {selectors}

        <div
          ref={boxRef}
          className="relative min-w-0"
          onBlur={(e) => {
            if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
          }}
        >
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={`Sort designs on this page: ${activeLabel}`}
            title="Sort designs on this page"
            aria-haspopup="listbox"
            aria-expanded={open}
            className="fl-shop-filter h-full w-full"
          >
            <span className="min-w-0"><span className="fl-shop-filter__label">Sort by</span><span className="fl-shop-filter__value">{activeLabel}</span></span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
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

      <p className="text-[12px] text-ink-muted sm:text-sm">{count} {count === 1 ? "design" : "designs"}</p>

      <div ref={gridRef} className="fl-grid" data-shop-path={routePath}>
        {sorted.map((product, i) => (
          <ProductCard
            key={product.id}
            product={product}
            device={device ?? null}
            deviceSlug={deviceSlug ?? null}
            caseType={caseType ?? null}
            caseTypeSlug={caseTypeSlug ?? null}
            // Two desktop rows (four columns) get early requests. Keep this
            // bounded on mobile too, without waiting for viewport hydration.
            priority={i < SHOP_PRIORITY_IMAGES}
            fetchPriority={i < SHOP_PRIORITY_IMAGES ? "high" : "low"}
            deferImage={deferred(i)}
          />
        ))}
      </div>

      {totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-center gap-2 pt-4"
        >
          {currentPage > 1 ? (
            <Link
              href={hrefFor(currentPage - 1)}
              aria-label="Previous page"
              className="grid size-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink"
              scroll
            >
              &#8249;
            </Link>
          ) : null}

          {pageWindow(currentPage, totalPages).map((p, i) =>
            p === "…" ? (
              <span
                key={`gap-${i}`}
                className="grid size-10 place-items-center text-ink-faint"
              >
                &hellip;
              </span>
            ) : p === currentPage ? (
              <span
                key={p}
                aria-current="page"
                className="grid size-10 place-items-center rounded-full bg-ink text-sm font-semibold text-white"
              >
                {p}
              </span>
            ) : (
              <Link
                key={p}
                href={hrefFor(p)}
                className="grid size-10 place-items-center rounded-full border border-line text-sm text-ink transition-colors hover:border-ink"
                scroll
              >
                {p}
              </Link>
            )
          )}

          {currentPage < totalPages ? (
            <Link
              href={hrefFor(currentPage + 1)}
              aria-label="Next page"
              className="grid size-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink"
              scroll
            >
              &#8250;
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
