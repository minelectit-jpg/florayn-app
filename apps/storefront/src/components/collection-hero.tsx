import Link from "@/components/audience-link"

import ArtImage from "@/components/art-image"
import type { CollectionPage } from "@/lib/content"

/**
 * The top of a collection landing page, in the layout the admin picked:
 *
 *   overlay   full-bleed photo, copy bottom-left (florayn's default hero)
 *   centered  full-bleed photo, a big centred headline
 *   image     the photo alone - for campaign art with the title baked in
 *   split     a coloured panel with the copy beside the picture (Van Gogh,
 *             Bug Life), with optional decor scattered over the panel
 *
 * With no picture at all, any layout falls back to split with the
 * collection's own product artwork, which reads right on every theme.
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
  const photo = page.hero_image_url
  const layout = photo ? page.template : "split"
  const image = photo || fallbackImage
  // A button pointing at this same page means "take me to the products".
  const own = `/collection/${page.collection_slug}/`
  const ctaHref =
    page.cta_href === own || page.cta_href === own.slice(0, -1) ? "#shop" : page.cta_href
  const cta =
    page.cta_label && ctaHref ? (
      <Link href={ctaHref} className="fl-chero__cta">
        {page.cta_label}
      </Link>
    ) : null

  const copy = (
    <div className="fl-chero__copy">
      {page.hero_eyebrow ? <p className="fl-chero__eyebrow">{page.hero_eyebrow}</p> : null}
      <h1 className="fl-chero__title">{heading}</h1>
      {page.hero_copy ? <p className="fl-chero__text">{page.hero_copy}</p> : null}
      {cta}
    </div>
  )

  let hero
  if (layout === "split") {
    hero = (
      <div className="fl-chero fl-chero--split">
        <div className="fl-chero__panel">
          {page.theme.decor.length ? (
            <div className="fl-chero__decor" aria-hidden="true">
              {page.theme.decor.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${src}-${i}`} src={src} alt="" loading="lazy" decoding="async" />
              ))}
            </div>
          ) : null}
          {copy}
        </div>
        <div className={`fl-chero__media${photo ? "" : " is-artwork"}`}>
          {image ? (
            <ArtImage
              src={image}
              mobileSrc={page.hero_mobile_image_url}
              alt=""
              priority
              sizes="(max-width: 767px) 100vw, 50vw"
              className={photo ? "object-cover" : "object-contain"}
            />
          ) : null}
        </div>
      </div>
    )
  } else if (layout === "image") {
    hero = (
      <div className="fl-chero fl-chero--image">
        <div className={`fl-chero__frame${page.hero_mobile_image_url ? " has-mobile" : ""}`}>
          <ArtImage
            src={photo!}
            mobileSrc={page.hero_mobile_image_url}
            alt={heading}
            priority
            sizes="(max-width: 1470px) 100vw, 1410px"
            className="object-cover"
          />
        </div>
        {/* The picture carries the title; keep the heading for the outline. */}
        <div className="fl-chero__below">
          <h1 className="sr-only">{heading}</h1>
          {cta}
        </div>
      </div>
    )
  } else {
    hero = (
      <div className={`fl-chero fl-chero--${layout}`}>
        <div className={`fl-chero__frame${page.hero_mobile_image_url ? " has-mobile" : ""}`}>
          <ArtImage
            src={photo!}
            mobileSrc={page.hero_mobile_image_url}
            alt=""
            priority
            sizes="(max-width: 1470px) 100vw, 1410px"
            className="object-cover"
          />
          <span className="fl-chero__shade" aria-hidden="true" />
          {copy}
        </div>
      </div>
    )
  }

  return (
    <section className="fl-chero-wrap">
      {hero}
      {page.intro_heading || page.intro_copy ? (
        <div className="fl-cintro">
          {page.intro_heading ? <h2 className="fl-cintro__title">{page.intro_heading}</h2> : null}
          {page.intro_copy ? <p className="fl-cintro__text">{page.intro_copy}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
