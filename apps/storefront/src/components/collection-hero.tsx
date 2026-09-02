import Link from "next/link"

import ProductImage from "@/components/product-image"
import type { CollectionPage } from "@/lib/content"

/**
 * The top of a collection landing page: a full-bleed hero, then the section
 * heading and copy above the grid.
 *
 * The ten live Elementor pages share this structure but not a design - their
 * headings range from 90px/600 right-aligned white to 136px/700 left-aligned
 * cream, with different button shapes. Rather than reproduce ten one-offs,
 * this is one consistent treatment on the brand scale, with the content
 * coming from the admin.
 */
export default function CollectionHero({
  page,
  fallbackImage,
  title,
}: {
  page: CollectionPage
  /** Used when no hero image is set: the collection's own artwork. */
  fallbackImage: string | null
  title: string
}) {
  const heading = page.hero_heading || title
  const image = page.hero_image_url || fallbackImage

  return (
    <section className="mb-10">
      <div className="relative flex h-[420px] items-end overflow-hidden rounded-[14px] bg-ink md:h-[587px]">
        <span className="absolute inset-0">
          <ProductImage
            src={image}
            alt=""
            label={heading}
            priority
            sizes="100vw"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/35 to-ink/10" />
        </span>

        <div className="relative z-10 w-full p-6 text-white md:p-12">
          {page.hero_eyebrow ? (
            <p className="text-[12px] font-semibold tracking-wide">
              {page.hero_eyebrow}
            </p>
          ) : null}
          <h1 className="display mt-2 max-w-3xl text-[38px] leading-[1.05] tracking-[-0.034em] sm:text-[56px] md:text-[72px]">
            {heading}
          </h1>
          {page.cta_label && page.cta_href ? (
            <Link
              href={page.cta_href}
              className="mt-6 inline-grid h-[50px] min-w-[200px] place-items-center rounded-[30px] bg-white px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-purple hover:text-white"
            >
              {page.cta_label}
            </Link>
          ) : null}
        </div>
      </div>

      {page.intro_heading || page.intro_copy ? (
        <div className="mx-auto mt-10 max-w-2xl text-center">
          {page.intro_heading ? (
            <h2 className="display text-[2.1rem] leading-tight tracking-[-0.034em]">
              {page.intro_heading}
            </h2>
          ) : null}
          {page.intro_copy ? (
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
              {page.intro_copy}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
