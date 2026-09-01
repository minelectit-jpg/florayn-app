import Link from "next/link"

import ProductImage from "@/components/product-image"
import QuickAdd from "@/components/quick-add"
import type { StoreProduct, StoreVariant } from "@/lib/medusa"
import { formatPrice, priceRange } from "@/lib/money"
import { buildMetaLine, splitProductTitle } from "@/lib/product-title"

export type CardBadge = { label: string; tone: "hot" | "soldout" | "sale" }

export default function ProductCard({
  product,
  device,
  badges,
}: {
  product: StoreProduct
  /** Selected device from the filter bar; drives the meta line and quick-add. */
  device?: string | null
  badges?: CardBadge[]
}) {
  const metadata = product.metadata ?? {}
  const caseTypeName = metadata.case_type_name as string | undefined
  const designName =
    (metadata.design_name as string) ?? splitProductTitle(product.title).design

  const variants = product.variants ?? []
  const selected: StoreVariant | undefined = device
    ? variants.find((v) => v.title === device)
    : undefined
  // Price is flat per case type, so any variant gives the card price.
  const priced = selected ?? variants[0]
  const range = priceRange(variants)

  const image = product.thumbnail ?? product.images?.[0]?.url
  const meta = buildMetaLine({ device, caseType: caseTypeName })

  const soldOut = variants.length === 0
  const resolvedBadges: CardBadge[] =
    badges ?? (soldOut ? [{ label: "Sold out", tone: "soldout" }] : [])

  return (
    <article className="fl-card">
      <Link
        href={`/product/${product.handle}/`}
        className="flex flex-1 flex-col"
        aria-label={`${designName}${meta ? `, ${meta}` : ""}`}
      >
        <div className="fl-card__media">
          {resolvedBadges.length ? (
            <div className="fl-card__badges">
              {resolvedBadges.map((badge) => (
                <span
                  key={badge.label}
                  className={`fl-badge fl-badge--${badge.tone}`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}

          <ProductImage
            src={image}
            alt={product.title}
            label={designName}
            sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
            className="fl-card__img"
            fillMode="absolute"
          />
        </div>

        <div className="fl-card__summary">
          <h3 className="fl-card__title">{designName}</h3>
          {meta ? <p className="fl-card__meta">{meta}</p> : null}

          <div className="fl-card__price-row">
            <span className="fl-card__price">
              {range
                ? range.min === range.max
                  ? formatPrice(range.min)
                  : `From ${formatPrice(range.min)}`
                : "-"}
            </span>

            <QuickAdd
              variantId={priced?.id ?? null}
              productTitle={product.title}
              variantTitle={priced?.title ?? ""}
              unitPrice={priced?.calculated_price?.calculated_amount ?? 0}
              thumbnail={image ?? null}
              disabled={soldOut}
            />
          </div>
        </div>
      </Link>
    </article>
  )
}
