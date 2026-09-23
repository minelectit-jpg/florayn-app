import { ArrowRight, ArrowUpRight, BadgeCheck, Star } from "lucide-react"
import Link from "next/link"
import type { CSSProperties } from "react"

import ArtImage from "@/components/art-image"
import DragScroll from "@/components/drag-scroll"
import HeroSlider, { type HeroSlide } from "@/components/hero-slider"
import ProductCard from "@/components/product-card"
import type { CollectionCard, HomeSection } from "@/lib/content"
import type { StoreProduct } from "@/lib/medusa"

/*
 * The home page bands. Each reads its own `config` from the admin (Home page
 * screen), so pictures, links and copy change without a deploy. Everything
 * here renders on the server; only the hero slideshow and the drag-to-scroll
 * rails hydrate.
 */

function SectionHeader({
  section,
  fallbackTitle,
  moreHref,
  moreLabel = "View all",
  center = false,
}: {
  section: HomeSection
  fallbackTitle?: string
  moreHref?: string | null
  moreLabel?: string
  center?: boolean
}) {
  const title = section.title ?? fallbackTitle
  if (!title && !section.eyebrow && !section.subtitle) return null
  return (
    <div className={`fl-home-head${center ? " is-center" : ""}`}>
      <div>
        {section.eyebrow ? <p className="fl-home-eyebrow">{section.eyebrow}</p> : null}
        {title ? <h2 className="fl-home-title">{title}</h2> : null}
        {section.subtitle ? <p className="fl-home-subtitle">{section.subtitle}</p> : null}
      </div>
      {moreHref && !center ? (
        <Link href={moreHref} className="fl-home-more">
          {moreLabel}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  )
}

function initials(label: string) {
  return label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
}

/** Round category shortcuts with product photos, the first band on live. */
function CategoryPills({ section }: { section: HomeSection }) {
  const items: { label: string; href: string | null; note?: string; image?: string | null }[] =
    section.config.items ?? []
  if (!items.length) return null

  return (
    <section className="fl-home-pills" aria-label={section.title ?? "Shop by category"}>
      <ul>
        {items.map((item) => {
          const body = (
            <>
              <span className="fl-home-pills__circle">
                {item.image ? (
                  <ArtImage src={item.image} alt="" sizes="96px" className="object-cover" />
                ) : (
                  <span className="fl-home-pills__initials" aria-hidden="true">{initials(item.label)}</span>
                )}
              </span>
              <span className="fl-home-pills__label">
                {item.label}
                {item.note ? <span className="fl-home-pills__note">{item.note}</span> : null}
              </span>
            </>
          )
          return (
            <li key={item.label}>
              {item.href ? (
                <Link href={item.href} className="fl-home-pills__item">{body}</Link>
              ) : (
                <span aria-disabled="true" className="fl-home-pills__item is-disabled">{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Hero({ section }: { section: HomeSection }) {
  const slides: HeroSlide[] = (section.config.slides ?? [])
    .filter((s: Partial<HeroSlide>) => s && s.href)
    .map((s: Partial<HeroSlide>) => ({
      eyebrow: s.eyebrow ?? null,
      heading: s.heading ?? null,
      href: s.href!,
      cta_label: s.cta_label ?? null,
      image: s.image ?? null,
      mobile_image: s.mobile_image ?? null,
    }))
  if (!slides.length) return null
  return <HeroSlider slides={slides} ctaLabel={section.cta_label ?? "Shop Collection"} />
}

/** A slow ticker of short store promises (delivery, payment). */
function Marquee({ section }: { section: HomeSection }) {
  const items: string[] = (section.config.items ?? []).filter(Boolean)
  const messages = items.length ? items : section.title ? [section.title] : []
  if (!messages.length) return null
  // Enough copies to overfill a wide screen; the second half loops the first.
  const run = Array.from({ length: Math.max(2, Math.ceil(8 / messages.length)) }, () => messages).flat()

  return (
    <section className="fl-marquee" aria-label={messages.join(". ")}>
      <div className="fl-marquee__track" aria-hidden="true">
        {[0, 1].map((half) => (
          <ul key={half}>
            {run.map((text, i) => (
              <li key={`${half}-${i}`}>
                <span className="fl-marquee__dot" />
                {text}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  )
}

/** Picture tiles with the label bottom-left and a corner arrow, as on live. */
function TileGrid({ section }: { section: HomeSection }) {
  const tiles: { label: string; subtitle?: string | null; href: string; image?: string | null }[] =
    section.config.tiles ?? []
  const columns = Number(section.config.columns) || 2
  if (!tiles.length) return null

  const cols = columns >= 4 ? 4 : columns === 3 ? 3 : 2
  const sizes =
    cols === 4
      ? "(max-width: 1023px) 50vw, 25vw"
      : cols === 3
        ? "(max-width: 767px) 100vw, 33vw"
        : "(max-width: 639px) 100vw, 50vw"

  return (
    <section className="fl-home-section">
      <SectionHeader section={section} />
      <ul className={`fl-tiles fl-tiles--${cols}`}>
        {tiles.map((tile) => (
          <li key={`${tile.label}-${tile.href}`}>
            <Link href={tile.href} className="fl-tile group">
              {tile.image ? (
                <ArtImage
                  src={tile.image}
                  alt=""
                  sizes={sizes}
                  className="fl-tile__img object-cover"
                />
              ) : (
                <span className="fl-tile__placeholder" aria-hidden="true">{initials(tile.label)}</span>
              )}
              <span className="fl-tile__shade" aria-hidden="true" />
              <span className="fl-tile__body">
                <span>
                  <span className="fl-tile__label">{tile.label}</span>
                  {tile.subtitle ? <span className="fl-tile__subtitle">{tile.subtitle}</span> : null}
                </span>
                <span className="fl-tile__arrow" aria-hidden="true">
                  <ArrowUpRight size={18} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProductRow({
  section,
  products,
}: {
  section: HomeSection
  products: StoreProduct[]
}) {
  if (!products.length) return null
  const cols = products.length % 5 === 0 ? 5 : 4

  return (
    <section className="fl-home-section">
      <SectionHeader
        section={section}
        moreHref={section.cta_href}
        moreLabel={section.cta_label ?? "View all"}
      />
      <div className="fl-rail" style={{ "--rail-cols": cols } as CSSProperties}>
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      {section.cta_label && section.cta_href ? (
        <div className="fl-home-cta-mobile">
          <Link href={section.cta_href} className="fl-button fl-button--outline">
            {section.cta_label}
          </Link>
        </div>
      ) : null}
    </section>
  )
}

/** The collection landing pages as tall picture cards, in their admin order. */
function CollectionGrid({
  section,
  collections,
}: {
  section: HomeSection
  collections: CollectionCard[]
}) {
  const wanted: string[] = section.config.slugs ?? []
  const limit = Number(section.config.limit) || 12
  const cards = (
    wanted.length
      ? wanted
          .map((slug) => collections.find((c) => c.slug === slug))
          .filter((c): c is CollectionCard => Boolean(c))
      : collections
  ).slice(0, limit)
  if (!cards.length) return null

  return (
    <section className="fl-home-section">
      <SectionHeader
        section={section}
        fallbackTitle="Shop by Collection"
        moreHref="/collections/"
        moreLabel="All collections"
      />
      <DragScroll className="fl-collection-rail" aria-label={section.title ?? "Collections"}>
        {cards.map((card) => (
          <li key={card.slug}>
            <Link
              href={`/collection/${card.slug}/`}
              className="fl-collection-card group"
              style={
                {
                  "--cc-bg": card.image ? card.theme.hero_bg : card.theme.bg,
                  "--cc-accent": card.theme.accent,
                  "--cc-accent-text": card.theme.accent_text,
                } as CSSProperties
              }
              draggable={false}
            >
              {card.image || card.artwork ? (
                <ArtImage
                  src={(card.image ?? card.artwork)!}
                  alt=""
                  sizes="(max-width: 767px) 70vw, (max-width: 1023px) 40vw, 300px"
                  className={card.image ? "fl-collection-card__img object-cover" : "fl-collection-card__img fl-collection-card__img--art object-contain"}
                />
              ) : null}
              <span className="fl-collection-card__shade" aria-hidden="true" />
              <span className="fl-collection-card__body">
                <span className="fl-collection-card__title">{card.title}</span>
                <span className="fl-collection-card__cta">
                  Explore <ArrowRight size={14} aria-hidden="true" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </DragScroll>
    </section>
  )
}

/** A full-width campaign banner with its copy centred over the picture. */
function Banner({ section }: { section: HomeSection }) {
  const image: string | null = section.config.image ?? null
  if (!image && !section.title) return null
  const content = (
    <span className="fl-banner__copy">
      {section.eyebrow ? <span className="fl-banner__eyebrow">{section.eyebrow}</span> : null}
      {section.title ? <span className="fl-banner__title">{section.title}</span> : null}
      {section.subtitle ? <span className="fl-banner__subtitle">{section.subtitle}</span> : null}
      {section.cta_label ? <span className="fl-banner__cta">{section.cta_label}</span> : null}
    </span>
  )
  return (
    <section className="fl-home-section">
      {section.cta_href ? (
        <Link href={section.cta_href} className="fl-banner group">
          {image ? (
            <ArtImage src={image} mobileSrc={section.config.mobile_image} alt="" sizes="(max-width: 1470px) 100vw, 1410px" className="fl-banner__img object-cover" />
          ) : null}
          <span className="fl-banner__shade" aria-hidden="true" />
          {content}
        </Link>
      ) : (
        <div className="fl-banner">
          {image ? (
            <ArtImage src={image} mobileSrc={section.config.mobile_image} alt="" sizes="(max-width: 1470px) 100vw, 1410px" className="fl-banner__img object-cover" />
          ) : null}
          <span className="fl-banner__shade" aria-hidden="true" />
          {content}
        </div>
      )}
    </section>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="fl-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={15} aria-hidden="true" className={i < rating ? "is-on" : ""} />
      ))}
    </span>
  )
}

function Testimonials({ section }: { section: HomeSection }) {
  const quotes: { name: string; badge?: string | null; body: string; rating?: number }[] =
    section.config.quotes ?? []
  if (!quotes.length) return null

  return (
    <section className="fl-home-section">
      <SectionHeader section={section} center />
      <ul className="fl-quotes">
        {quotes.map((quote) => (
          <li key={quote.name} className="fl-quote">
            <Stars rating={Math.min(5, Math.max(1, Number(quote.rating) || 5))} />
            <p className="fl-quote__body">&ldquo;{quote.body}&rdquo;</p>
            <div className="fl-quote__who">
              <span className="fl-quote__avatar" aria-hidden="true">{initials(quote.name)}</span>
              <span>
                <span className="fl-quote__name">{quote.name}</span>
                {quote.badge ? (
                  <span className="fl-quote__badge">
                    <BadgeCheck size={14} aria-hidden="true" />
                    {quote.badge}
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Renders one section by type. Unknown types are skipped, not crashed on. */
export default function HomeSectionRenderer({
  section,
  products,
  collections = [],
}: {
  section: HomeSection
  products: StoreProduct[]
  collections?: CollectionCard[]
}) {
  switch (section.type) {
    case "category_pills":
      return <CategoryPills section={section} />
    case "hero":
      return <Hero section={section} />
    case "marquee":
      return <Marquee section={section} />
    case "tile_grid":
      return <TileGrid section={section} />
    case "product_carousel":
      return <ProductRow section={section} products={products} />
    case "collection_grid":
      return <CollectionGrid section={section} collections={collections} />
    case "banner":
      return <Banner section={section} />
    case "testimonials":
      return <Testimonials section={section} />
    default:
      return null
  }
}
