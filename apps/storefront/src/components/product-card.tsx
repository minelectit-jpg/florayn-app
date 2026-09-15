import Link from "next/link"

import Price from "@/components/price"
import ProductImage from "@/components/product-image"
import QuickAdd from "@/components/quick-add"
import type { StoreProduct, StoreVariant } from "@/lib/medusa"
import { priceRange } from "@/lib/money"
import { buildMetaLine, splitProductTitle } from "@/lib/product-title"

export type CardBadge = { label: string; tone: "hot" | "soldout" | "sale" }

/** Variants whose options include every given value (device and/or case type). */
function scopeVariants(
  variants: StoreVariant[],
  values: (string | null | undefined)[]
): StoreVariant[] {
  const wanted = values.filter(Boolean) as string[]
  if (!wanted.length) return variants
  return variants.filter((v) =>
    wanted.every((val) => (v.options ?? []).some((o) => o.value === val))
  )
}

export default function ProductCard({
  product,
  device,
  deviceSlug,
  caseType,
  badges,
}: {
  product: StoreProduct
  /** Selected device from the filter bar; drives the link, image and price. */
  device?: string | null
  /** Device slug, so the card links to that device's own page. */
  deviceSlug?: string | null
  /** Selected case type; scopes the price and meta so they don't span all types. */
  caseType?: string | null
  badges?: CardBadge[]
}) {
  const metadata = product.metadata ?? {}
  const designName =
    (metadata.design_name as string) ?? splitProductTitle(product.title).design

  const variants = product.variants ?? []
  // Scope to the chosen device and/or case type so the price is that exact
  // combination's, not a range spanning every construction ("From 1,400").
  const scoped = scopeVariants(variants, [device, caseType])
  const priced = scoped[0] ?? variants[0]
  const range = priceRange(scoped.length ? scoped : variants)

  const deviceImage = device
    ? ((priced?.metadata?.images as string[] | undefined) ?? [])[0]
    : undefined
  const image = deviceImage ?? product.thumbnail ?? product.images?.[0]?.url

  // Meta line: "iPhone 17 Pro Max Case • Signature" when both are chosen; the
  // form label (e.g. "AirPods Case") when neither is.
  const meta = buildMetaLine({
    device,
    caseType: caseType ?? (device ? null : (product.subtitle ?? null)),
  })

  // A chosen device deep-links to that device's own page, preselected.
  const href =
    device && deviceSlug
      ? `/product/${product.handle}-${deviceSlug}/`
      : `/product/${product.handle}/`

  const soldOut = variants.length === 0
  const resolvedBadges: CardBadge[] =
    badges ?? (soldOut ? [{ label: "Sold out", tone: "soldout" }] : [])

  return (
    <article className="fl-card">
      <Link
        href={href}
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
          <div className="fl-card__titles">
            <h3 className="fl-card__title">{designName}</h3>
            {meta ? <p className="fl-card__meta">{meta}</p> : null}
          </div>

          <div className="fl-card__price-row">
            <span className="fl-card__price">
              {range ? (
                range.min === range.max ? (
                  <Price amount={range.min} />
                ) : (
                  <>From <Price amount={range.min} /></>
                )
              ) : (
                "-"
              )}
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
