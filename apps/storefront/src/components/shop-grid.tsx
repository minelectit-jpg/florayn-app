"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

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
  routePath: string
}) {
  const [sort, setSort] = useState<SortKey>("featured")

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
    routePath, device, caseType,
    sorted.map((product) => [
      product.id, product.thumbnail, product.images?.map((image) => image.url),
      product.variants?.map((variant) => [variant.id, variant.options, variant.metadata?.images]),
    ]),
  ]), [routePath, device, caseType, sorted])
  const { gridRef, deferred } = useShopImageLoading(imageBatchKey)

  const count = totalCount ?? products.length

  const base = !deviceSlug
    ? "/shop/"
    : caseTypeSlug
      ? `/shop/${deviceSlug}/${caseTypeSlug}/`
      : `/shop/${deviceSlug}/`
  const hrefFor = (p: number) => (p > 1 ? `${base}${p}/` : base)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">{count}</span> {count === 1 ? "design" : "designs"}{totalPages > 1 ? <span className="ml-2 hidden text-xs sm:inline">· Page {currentPage} of {totalPages}</span> : null}
        </p>

        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="hidden sm:inline">Sort this page</span>
          <select aria-label="Sort designs on this page" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="max-w-[185px] rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-ink [color-scheme:light] focus-visible:outline-2 focus-visible:outline-purple">
            {SORTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
      </div>

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

      <p className="pt-4 text-center text-xs text-ink-muted">Showing {products.length} of {count} designs{totalPages > 1 ? ` · Page ${currentPage} of ${totalPages}` : ""}</p>
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
