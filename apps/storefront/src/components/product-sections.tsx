import Link from "next/link"

import DragScroll from "@/components/drag-scroll"
import Price from "@/components/price"
import ProductImage from "@/components/product-image"

/** Device/case-type NAME -> its URL slug ("iPhone 17 Pro Max" -> "iphone-17-pro-max").
 *  Verified to match every live device + case-type slug exactly. */
const slugify = (s?: string) =>
  s ? s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : ""

export type RelatedProduct = {
  id: string
  title: string
  handle: string
  thumbnail?: string | null
  label: string
  price?: number | null
  /** "device|caseType" -> that design in the exact same finish and model. */
  imageByPair?: Record<string, string>
  /** device name -> that design on that device, when the exact pair is absent. */
  imageByDevice?: Record<string, string>
}

/**
 * MORE DESIGNS - other artwork in the same finish. A 108px drag-scroll strip
 * on the live page, 12px apart. Each thumbnail follows the customer's current
 * choice: the same case type on the same device where that design offers it,
 * else the same device, else the design's own thumbnail.
 */
export function MoreDesigns({
  items,
  device,
  caseType,
  currentName,
  currentImage,
}: {
  items: RelatedProduct[]
  device?: string
  caseType?: string
  /** The design being viewed, shown first as the selected tile (like CASE TYPE). */
  currentName?: string
  currentImage?: string | null
}) {
  if (!items.length && !currentName) return null

  return (
    <section className="mt-6">
      <p className="fl-pdp-label">MORE DESIGNS</p>
      <DragScroll className="flex gap-[12px] overflow-x-auto pb-2">
        {currentName ? (
          <li className="shrink-0">
            {/* The current design, highlighted like the selected CASE TYPE tile.
                Not a link — the customer is already on it. */}
            <div
              title={currentName}
              aria-current="true"
              className="block size-[108px] overflow-hidden rounded-[10px] border-2 border-purple"
            >
              <span className="relative block size-full">
                <ProductImage
                  src={currentImage ?? null}
                  alt={currentName}
                  label={currentName}
                  sizes="108px"
                />
              </span>
            </div>
          </li>
        ) : null}
        {items.map((item) => {
          const src =
            (device && caseType
              ? item.imageByPair?.[`${device}|${caseType}`]
              : null) ??
            (device ? item.imageByDevice?.[device] : null) ??
            item.thumbnail
          // Carry the customer's current model + finish onto the link, so the
          // design opens on what they were viewing instead of the default
          // (iPhone 17 Pro Max / Signature). Only append the device when this
          // design actually sells it; the ?case is honoured client-side if the
          // design offers it, else the page snaps to a valid pair.
          const dev = device && item.imageByDevice?.[device] ? slugify(device) : ""
          const ct = slugify(caseType)
          const href = dev
            ? `/product/${item.handle}-${dev}/${ct ? `?case=${ct}` : ""}`
            : `/product/${item.handle}/`
          return (
            <li key={item.id} className="shrink-0">
              <Link
                href={href}
                title={item.label}
                className="block size-[108px] overflow-hidden rounded-[10px] border border-[#ececec] transition-colors hover:border-purple"
                prefetch={false}
              >
                <span className="relative block size-full">
                  <ProductImage
                    src={src}
                    alt={item.label}
                    label={item.label}
                    sizes="108px"
                  />
                </span>
              </Link>
            </li>
          )
        })}
      </DragScroll>
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
                  prefetch={false}
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
              prefetch={false}
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
        Ratings pool per design, so every case type built from {designName}{" "}
        shares one score and one list. No review store is wired up yet, so there
        is nothing to show.
      </p>
    </div>
  )
}
