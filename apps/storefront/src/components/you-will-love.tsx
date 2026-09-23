import Link from "next/link"

import DragScroll from "@/components/drag-scroll"
import Price from "@/components/price"
import ProductImage from "@/components/product-image"
import QuickAdd from "@/components/quick-add"

/** NAME -> URL slug ("iPhone 17 Pro Max" -> "iphone-17-pro-max"), as in MoreDesigns. */
const slugify = (s?: string) =>
  s ? s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : ""

/**
 * The product link for a "you'll love" card. Carries the customer's current
 * model + case type so the design opens on what the card is showing (e.g. Elite
 * Clear ৳1,600), not the product's default (iPhone 17 Pro Max / Signature). The
 * device is only appended when this design actually sells it; ?case is honoured
 * client-side if the design offers it, else the page snaps to a valid pair.
 */
export function youWillLoveHref(
  item: Pick<YouWillLoveItem, "handle" | "imageByDevice">,
  device?: string,
  caseType?: string
): string {
  const dev = device && item.imageByDevice[device] ? slugify(device) : ""
  const ct = slugify(caseType)
  return dev
    ? `/product/${item.handle}-${dev}/${ct ? `?case=${ct}` : ""}`
    : `/product/${item.handle}/${ct ? `?case=${ct}` : ""}`
}

export type YouWillLoveItem = {
  id: string
  /** Design name shown on the card. */
  name: string
  handle: string
  thumbnail: string | null
  /** "device|caseType" -> that design in the exact model and construction. */
  imageByPair: Record<string, string>
  /** device -> that design on that device, when the exact pair is absent. */
  imageByDevice: Record<string, string>
  /** "device|caseType" -> the variant to quick-add, and its price. */
  variantByPair: Record<string, { id: string; price: number }>
  /** Lowest price, shown before an exact pair resolves. */
  price: number | null
}

/**
 * "We think you'll love" — a hand-picked row of designs, styled like the shop
 * card. It follows the live device AND case type: each card shows the design in
 * the exact model and construction the customer has chosen, priced and added
 * for that same variant. Compact by design (renders + one variant per pair, not
 * whole products) so the page stays light.
 */
export default function YouWillLove({
  items,
  device,
  caseType,
  title = "We think you'll love",
}: {
  items: YouWillLoveItem[]
  device?: string
  caseType?: string
  title?: string
}) {
  // Only designs made in the shopper's exact model and case type; the heading
  // goes with them, so an empty strip leaves nothing behind.
  const shown = items.filter((item) => !device || !caseType || !!item.variantByPair[`${device}|${caseType}`])
  if (!shown.length) return null
  const single = shown.length === 1

  return (
    <section>
      <div className="fl-pdp-strip__head">
        <span aria-hidden="true" />
        <h2>{title}</h2>
        <span aria-hidden="true" />
      </div>

      <DragScroll className={`fl-pdp-rail${single ? " is-single" : ""}`} aria-label={title}>
        {shown.map((item, i) => {
          const pair = device && caseType ? `${device}|${caseType}` : ""
          const image =
            item.imageByPair[pair] ??
            (device ? item.imageByDevice[device] : null) ??
            item.thumbnail
          const variant = item.variantByPair[pair]
          const price = variant?.price ?? item.price
          const href = youWillLoveHref(item, device, caseType)
          return (
            <li key={`${item.id}-${i}`}>
              <article className="fl-card group">
                <div className="fl-card__media">
                  <ProductImage
                    src={image}
                    alt={item.name}
                    label={item.name}
                    sizes={single ? "(max-width: 767px) calc(100vw - 30px), 230px" : "(max-width: 767px) calc(50vw - 20px), 230px"}
                    className="fl-card__img"
                    fillMode="absolute"
                  />
                </div>

                <div className="fl-card__summary">
                  <div className="fl-card__titles">
                    <h3 className="fl-card__title">{item.name}</h3>
                    {device || caseType ? (
                      <p className="fl-card__meta">
                        {device ? <span>{`${device} Case`}</span> : null}
                        {device && caseType ? <span className="fl-card__meta-separator" aria-hidden="true"> • </span> : null}
                        {caseType ? <span className="fl-card__case-type">{caseType}</span> : null}
                      </p>
                    ) : null}
                  </div>

                  <div className="fl-card__price-row">
                    <span className="fl-card__price">
                      {price != null ? <Price amount={price} /> : "-"}
                    </span>
                    <QuickAdd
                      variantId={variant?.id ?? null}
                      productTitle={item.name}
                      variantTitle={caseType ?? ""}
                      unitPrice={price ?? 0}
                      thumbnail={image ?? null}
                    />
                  </div>
                </div>

                {/* Stretched-link overlay: keeps the card clickable without
                    nesting the QuickAdd button inside an <a>. */}
                <Link
                  href={href}
                  aria-label={item.name}
                  className="absolute inset-0 z-[1]"
                  prefetch={false}
                />
              </article>
            </li>
          )
        })}
      </DragScroll>
    </section>
  )
}
