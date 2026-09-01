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
      className="group block border border-[var(--color-line)] bg-white transition-colors hover:border-[var(--color-ink)]"
    >
      <div className="relative aspect-square overflow-hidden bg-[var(--color-paper)]">
        <ProductImage
          src={image}
          alt={product.title}
          label={designName ?? product.title}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="transition-transform duration-500 group-hover:scale-105"
        />
      </div>

      <div className="space-y-1 p-4">
        <h3 className="display text-base leading-tight">
          {designName ?? product.title}
        </h3>
        {caseTypeName ? (
          <p className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
            {caseTypeName}
          </p>
        ) : null}
        <p className="pt-1 text-sm">
          {range ? (
            <>
              {range.min === range.max
                ? formatPrice(range.min)
                : `From ${formatPrice(range.min)}`}
              <span className="text-[var(--color-ink-soft)]">
                {" "}
                &middot; {variantCount} devices
              </span>
            </>
          ) : (
            <span className="text-[var(--color-ink-soft)]">Unavailable</span>
          )}
        </p>
      </div>
    </Link>
  )
}
