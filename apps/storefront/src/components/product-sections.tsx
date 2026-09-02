import Link from "next/link"

import Price from "@/components/price"
import ProductImage from "@/components/product-image"

export type RelatedProduct = {
  id: string
  title: string
  handle: string
  thumbnail?: string | null
  label: string
  price?: number | null
}

/**
 * MORE DESIGNS - other artwork in the same finish. A 108px drag-scroll strip
 * on the live page, 12px apart.
 */
export function MoreDesigns({ items }: { items: RelatedProduct[] }) {
  if (!items.length) return null

  return (
    <section className="mt-6">
      <p className="fl-pdp-label">MORE DESIGNS</p>
      <ul className="flex gap-[12px] overflow-x-auto pb-2">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <Link
              href={`/product/${item.handle}/`}
              title={item.label}
              className="block size-[108px] overflow-hidden rounded-[10px] border border-[#ececec] transition-colors hover:border-purple"
            >
              <span className="relative block size-full">
                <ProductImage
                  src={item.thumbnail}
                  alt={item.label}
                  label={item.label}
                  sizes="108px"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * CASE TYPE - the same design in its other constructions, each tile showing
 * the finish and its price. 135x205 tiles, 10px apart; four of them fill the
 * 570px column exactly on the live page.
 */
export function CaseTypeTiles({
  items,
  currentHandle,
}: {
  items: RelatedProduct[]
  currentHandle: string
}) {
  if (items.length < 2) return null

  return (
    <section className="mt-6">
      <p className="fl-pdp-label">CASE TYPE</p>
      <ul className="flex flex-wrap gap-[10px]">
        {items.map((item) => {
          const isCurrent = item.handle === currentHandle
          const tile = (
            <>
              <span className="relative block h-[150px] w-full overflow-hidden rounded-t-[9px]">
                <ProductImage
                  src={item.thumbnail}
                  alt={item.label}
                  label={item.label}
                  sizes="135px"
                />
              </span>
              <span className="block px-2 py-2 text-center">
                <span className="block text-[13px] font-semibold leading-tight">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[13px] tabular-nums text-ink-muted">
                  {item.price != null ? <Price amount={item.price} /> : null}
                </span>
              </span>
            </>
          )

          return (
            <li key={item.id}>
              {isCurrent ? (
                <div
                  aria-current="true"
                  className="flex h-[205px] w-[135px] flex-col overflow-hidden rounded-[10px] border border-purple bg-surface"
                >
                  {tile}
                </div>
              ) : (
                <Link
                  href={`/product/${item.handle}/`}
                  className="flex h-[205px] w-[135px] flex-col overflow-hidden rounded-[10px] border border-[#e2e2e2] bg-surface transition-colors hover:border-purple"
                >
                  {tile}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * The bordered delivery note that sits under the cart form on the live page.
 * The figures are our real shipping rules, not copy lifted from the live HTML.
 */
export function ShippingNote() {
  const lines = [
    "Estimated delivery: 1-3 days.",
    "We deliver all over Bangladesh.",
    "Cash on Delivery available. Delivery charge 60৳ inside Dhaka, 100৳ outside.",
    "Easy exchange within 3 days of delivery.",
  ]

  return (
    <ul className="mt-6 space-y-2 rounded-[5px] border border-line px-5 py-4 text-sm text-ink-muted">
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span aria-hidden="true" className="text-purple">
            &bull;
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * "Pairs well with" - the same design in a different product form, an AirPods
 * case or a wallet beside a phone case. Built from the design's own products,
 * so it is real data rather than a placeholder.
 */
export function PairsWellWith({ items }: { items: RelatedProduct[] }) {
  if (!items.length) return null

  return (
    <section className="mt-10">
      <h2 className="text-[1.125rem] font-semibold tracking-[-0.034em]">
        Pairs well with
      </h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/product/${item.handle}/`}
              className="flex items-center gap-4 rounded-[10px] border border-line bg-surface p-3 transition-colors hover:border-purple"
            >
              <span className="relative block size-[64px] shrink-0 overflow-hidden rounded-[8px]">
                <ProductImage
                  src={item.thumbnail}
                  alt=""
                  label={item.label}
                  sizes="64px"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold tracking-[-0.01em]">
                  {item.title}
                </span>
                <span className="mt-0.5 block text-[13px] font-medium text-ink-muted">
                  {item.label}
                </span>
              </span>
              {item.price != null ? (
                <span className="shrink-0 text-sm tabular-nums">
                  <Price amount={item.price} />
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Reviews pool per design on the live site: every product built from one
 * design shares a rating, a count and a review list. Nothing in this build
 * stores reviews yet, so this is the shape of the section rather than the
 * section itself.
 */
export function DesignReviews({ designName }: { designName: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-line-strong bg-paper p-6">
      <p className="text-sm font-semibold">Reviews for {designName}</p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Ratings pool per design, so every case type built from {designName}
        {" "}shares one score and one list. No review store is wired up yet, so
        there is nothing to show.
      </p>
    </div>
  )
}
