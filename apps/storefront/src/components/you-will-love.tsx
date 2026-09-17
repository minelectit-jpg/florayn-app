"use client"

import DragScroll from "@/components/drag-scroll"
import ProductCard from "@/components/product-card"
import type { StoreProduct } from "@/lib/medusa"

/**
 * "We think you'll love" — a hand-picked row of designs, rendered with the same
 * shop product card. It follows the live device AND case type, so every pick
 * shows in the exact model and construction the customer has chosen.
 */
export default function YouWillLove({
  products,
  device,
  caseType,
  title = "We think you'll love",
}: {
  products: StoreProduct[]
  /** The live device, e.g. "iPhone 16 Pro Max". */
  device?: string
  /** The live case type, e.g. "Signature". */
  caseType?: string
  title?: string
}) {
  if (!products.length) return null

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
        {products.map((product) => (
          <li
            key={product.id}
            className="w-[190px] shrink-0 snap-start sm:w-[210px]"
          >
            <ProductCard
              product={product}
              device={device ?? null}
              caseType={caseType ?? null}
            />
          </li>
        ))}
      </DragScroll>
    </section>
  )
}
