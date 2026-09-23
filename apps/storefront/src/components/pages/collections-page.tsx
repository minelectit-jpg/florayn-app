import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import type { CSSProperties } from "react"

import ArtImage from "@/components/art-image"
import Link from "@/components/audience-link"
import { withAudience, type Audience } from "@/lib/audience"
import { collectionsFor, getSiteContent } from "@/lib/content"

export function collectionsMetadata(audience: Audience): Metadata {
  return {
    title: audience === "men" ? "Collections for Men" : "Collections",
    description: "Every Florayn collection - each design comes in every model and case type.",
    alternates: { canonical: withAudience("/collections/", audience) },
  }
}

/**
 * Every visible collection landing page as a card, in the admin's order -
 * florayn.com's /collections/ page. Same cached content read as the header,
 * so it adds no backend request. Men shows only collections with men designs.
 */
export default async function CollectionsPage({ audience }: { audience: Audience }) {
  const collections = collectionsFor((await getSiteContent()).collections, audience)

  return (
    <div className="space-y-8">
      <header className="mx-auto max-w-2xl text-center">
        <p className="fl-home-eyebrow">Florayn</p>
        <h1 className="fl-home-title md:text-[44px]">Collections</h1>
        <p className="fl-home-subtitle mx-auto">
          Pick a collection, then any model and case type.
        </p>
      </header>

      {collections.length ? (
        <ul className="fl-collections-grid">
          {collections.map((card, i) => (
            <li key={card.slug}>
              <Link
                href={`/collection/${card.slug}/`}
                className="fl-collection-card group"
                style={
                  {
                    "--cc-bg": card.image ? card.theme.hero_bg : "#ffffff",
                    "--cc-accent": card.theme.accent,
                    "--cc-accent-text": card.theme.accent_text,
                  } as CSSProperties
                }
              >
                {card.image || card.artwork ? (
                  <ArtImage
                    src={(card.image ?? card.artwork)!}
                    alt=""
                    priority={i < 4}
                    sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
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
        </ul>
      ) : (
        <p className="py-10 text-center text-sm text-ink-muted">No collections to show yet.</p>
      )}
    </div>
  )
}
