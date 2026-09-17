import Link from "next/link"

import DragScroll from "@/components/drag-scroll"
import Price from "@/components/price"
import ProductImage from "@/components/product-image"
import QuickAdd from "@/components/quick-add"

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
  if (!items.length) return null

  return (
    <section className="mt-12">
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <h2 className="text-center text-[1.05rem] font-semibold uppercase tracking-[0.04em]">
          {title}
        </h2>
        <span className="h-px flex-1 bg-line" />
      </div>

      <DragScroll className="mt-5 flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {items.map((item) => {
          const pair = device && caseType ? `${device}|${caseType}` : ""
          const image =
            item.imageByPair[pair] ??
            (device ? item.imageByDevice[device] : null) ??
            item.thumbnail
          const variant = item.variantByPair[pair]
          const price = variant?.price ?? item.price
          const meta =
            device && caseType
              ? `${device} Case · ${caseType}`
              : (caseType ?? device ?? "")
          return (
            <li
              key={item.id}
              className="w-[190px] shrink-0 snap-start sm:w-[210px]"
            >
              <article className="fl-card">
                <div className="fl-card__media">
                  <ProductImage
                    src={image}
                    alt={item.name}
                    label={item.name}
                    sizes="(max-width: 767px) 60vw, 210px"
                    className="fl-card__img"
                    fillMode="absolute"
                  />
                </div>

                <div className="fl-card__summary">
                  <div className="fl-card__titles">
                    <h3 className="fl-card__title">{item.name}</h3>
                    {meta ? <p className="fl-card__meta">{meta}</p> : null}
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
                  href={`/product/${item.handle}/`}
                  aria-label={item.name}
                  className="absolute inset-0 z-[1]"
                />
              </article>
            </li>
          )
        })}
      </DragScroll>
    </section>
  )
}
