import Link from "next/link"

import ProductImage from "@/components/product-image"
import type { StoreProduct } from "@/lib/medusa"
import { formatPrice, priceRange } from "@/lib/money"

export default function ProductCard({ product }: { product: StoreProduct }) {
  const range = priceRange(product.variants ?? [])
  const image = product.thumbnail ?? product.images?.[0]?.url
  const caseTypeName = product.metadata?.case_type_name as string | undefined
  const designName = product.metadata?.design_name as string | undefined
  const variantCount = product.variants?.length ?? 0

  return (
    <Link
      href={`/product/${product.handle}/`}
      className="group flex flex-col border border-line bg-surface transition-colors duration-200 hover:border-ink"
    >
      <div className="relative aspect-square overflow-hidden bg-paper">
        <ProductImage
          src={image}
          alt={product.title}
          label={designName ?? product.title}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]"
        />
      </div>

      <div className="flex flex-1 flex-col items-center gap-1.5 border-t border-line px-4 py-5 text-center">
        <h3 className="display text-[1.0625rem] leading-tight">
          {designName ?? product.title}
        </h3>

        {caseTypeName ? <p className="eyebrow">{caseTypeName}</p> : null}

        <p className="mt-auto pt-2 text-sm tabular-nums">
          {range ? (
            range.min === range.max ? (
              formatPrice(range.min)
            ) : (
              `From ${formatPrice(range.min)}`
            )
          ) : (
            <span className="text-ink-faint">Unavailable</span>
          )}
        </p>

        <p className="text-xs text-ink-faint">
          {variantCount} {variantCount === 1 ? "device" : "devices"}
        </p>
      </div>
    </Link>
  )
}
