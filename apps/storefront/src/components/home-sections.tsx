import Link from "next/link"

import ProductCard from "@/components/product-card"
import ProductImage from "@/components/product-image"
import type { HomeSection } from "@/lib/content"
import type { StoreProduct } from "@/lib/medusa"

// The root layout already provides the 1470 container and its padding,
// so sections only manage their own vertical rhythm.
const WRAP = "w-full"

/** Circular category shortcuts, the first band on the live home page. */
function CategoryPills({ section }: { section: HomeSection }) {
  const items: { label: string; href: string | null; note?: string }[] =
    section.config.items ?? []
  if (!items.length) return null

  return (
    <section className={`${WRAP} mt-9 mb-6`}>
      <ul className="flex gap-6 overflow-x-auto pb-2 sm:justify-center">
        {items.map((item) => {
          const body = (
            <>
              <span className="relative block size-[60px] overflow-hidden rounded-full border border-line">
                <ProductImage src={null} alt="" label={item.label} sizes="60px" />
              </span>
              <span className="mt-2 block max-w-[92px] text-center text-[11px] font-semibold uppercase leading-tight tracking-wide">
                {item.label}
                {item.note ? (
                  <span className="block font-normal text-ink-faint">
                    ({item.note})
                  </span>
                ) : null}
              </span>
            </>
          )
          return (
            <li key={item.label} className="shrink-0">
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex flex-col items-center transition-opacity hover:opacity-80"
                >
                  {body}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="flex cursor-default flex-col items-center opacity-55"
                >
                  {body}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * The hero. Live runs a carousel; this renders the first slide as the banner
 * and the rest as a row beneath, so every slide stays reachable without
 * shipping a carousel that hides three quarters of the content.
 */
function Hero({ section }: { section: HomeSection }) {
  const slides: { eyebrow: string; heading: string; href: string }[] =
    section.config.slides ?? []
  if (!slides.length) return null

  const [lead, ...rest] = slides
  const cta = section.cta_label ?? "Shop Collection"

  return (
    <section className={WRAP}>
      <Link
        href={lead.href}
        className="group relative flex h-[420px] items-end overflow-hidden rounded-[14px] bg-ink md:h-[505px]"
      >
        <span className="absolute inset-0">
          <ProductImage src={null} alt="" label={lead.heading} priority sizes="100vw" />
          <span className="absolute inset-0 bg-gradient-to-r from-ink/75 via-ink/40 to-transparent" />
        </span>
        <span className="relative z-10 max-w-xl p-6 text-white md:p-10">
          <span className="block text-[12px] font-semibold tracking-wide">
            {lead.eyebrow}
          </span>
          <span className="display mt-3 block text-[32px] leading-[1.1] tracking-[-0.034em] sm:text-[40px] md:text-[50px] md:leading-[55px]">
            {lead.heading}
          </span>
          <span className="mt-6 inline-grid h-[50px] w-[200px] place-items-center rounded-[30px] bg-white text-[15px] font-semibold text-ink transition-colors group-hover:bg-purple group-hover:text-white">
            {cta}
          </span>
        </span>
      </Link>

      {rest.length ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {rest.map((slide) => (
            <li key={slide.heading}>
              <Link
                href={slide.href}
                className="group relative flex h-[150px] items-end overflow-hidden rounded-[12px] bg-ink"
              >
                <span className="absolute inset-0">
                  <ProductImage src={null} alt="" label={slide.heading} sizes="33vw" />
                  <span className="absolute inset-0 bg-ink/45 transition-colors group-hover:bg-ink/30" />
                </span>
                <span className="relative z-10 p-5 text-white">
                  <span className="block text-[10px] font-semibold tracking-wide">
                    {slide.eyebrow}
                  </span>
                  <span className="display mt-1 block text-xl leading-tight">
                    {slide.heading}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** The repeating delivery strip. */
function Marquee({ section }: { section: HomeSection }) {
  const text = section.title ?? ""
  if (!text) return null
  const run = Array.from({ length: 8 }, (_, i) => i)

  return (
    <section className="my-6 overflow-hidden border-y border-line py-3">
      <ul className="flex justify-between gap-10 whitespace-nowrap px-4">
        {run.map((i) => (
          <li
            key={i}
            className="text-[13px] font-medium text-ink-muted"
            aria-hidden={i > 0}
          >
            {text}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Image tiles with the label bottom-left and a corner arrow, as on live. */
function TileGrid({ section }: { section: HomeSection }) {
  const tiles: { label: string; href: string }[] = section.config.tiles ?? []
  const columns = Number(section.config.columns) || 2
  if (!tiles.length) return null

  const height =
    columns >= 4 ? "h-[220px] md:h-[300px]" : "h-[320px] md:h-[504px]"
  const grid =
    columns >= 4
      ? "grid-cols-2 lg:grid-cols-4"
      : columns === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2"

  return (
    <section className={`${WRAP} mb-5`}>
      <ul className={`grid gap-4 ${grid}`}>
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Link
              href={tile.href}
              className={`group relative flex ${height} items-end overflow-hidden rounded-[12px] bg-surface`}
            >
              <span className="absolute inset-0">
                <ProductImage
                  src={null}
                  alt=""
                  label={tile.label}
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="transition-transform duration-700 group-hover:scale-[1.04]"
                />
              </span>
              <span className="relative z-10 flex w-full items-center justify-between p-6">
                <span className="text-lg font-semibold text-white drop-shadow">
                  {tile.label}
                </span>
                <span className="grid size-9 place-items-center rounded-full bg-white text-ink transition-colors group-hover:bg-purple group-hover:text-white">
                  ↗
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

  return (
    <section className={`${WRAP} mb-20`}>
      {section.title ? (
        <h2 className="display mb-5 text-[2.1rem] tracking-[-0.034em]">
          {section.title}
        </h2>
      ) : null}
      <div className="fl-grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      {section.cta_label && section.cta_href ? (
        <div className="mt-8 flex justify-center">
          <Link
            href={section.cta_href}
            className="inline-grid h-[50px] min-w-[200px] place-items-center rounded-[30px] border border-ink px-6 text-[15px] font-semibold transition-colors hover:bg-ink hover:text-white"
          >
            {section.cta_label}
          </Link>
        </div>
      ) : null}
    </section>
  )
}

function Testimonials({ section }: { section: HomeSection }) {
  const quotes: { name: string; badge: string; body: string }[] =
    section.config.quotes ?? []
  if (!quotes.length) return null

  return (
    <section className={`${WRAP} mb-20`}>
      <div className="mb-8 text-center">
        {section.title ? (
          <h2 className="display text-[2.1rem] tracking-[-0.034em]">
            {section.title}
          </h2>
        ) : null}
        {section.subtitle ? (
          <p className="mt-2 text-sm text-ink-muted">{section.subtitle}</p>
        ) : null}
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {quotes.map((quote) => (
          <li
            key={quote.name}
            className="rounded-[12px] border border-line bg-surface p-6"
          >
            <p className="text-sm leading-relaxed text-ink-muted">
              &ldquo;{quote.body}&rdquo;
            </p>
            <p className="mt-4 text-sm font-semibold">{quote.name}</p>
            {quote.badge ? (
              <p className="text-[12px] text-success">{quote.badge}</p>
            ) : null}
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
}: {
  section: HomeSection
  products: StoreProduct[]
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
    case "testimonials":
      return <Testimonials section={section} />
    default:
      return null
  }
}
