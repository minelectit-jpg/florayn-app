import Link from "next/link"

import ArtImage from "@/components/art-image"
import type { CollectionBlock } from "@/lib/content"

/**
 * The bands under a collection's product grid - florayn.com's "AirPods cases"
 * and "Armor" banners, or a paragraph of copy - in the order the admin set.
 */
export default function CollectionBlocks({ blocks }: { blocks: CollectionBlock[] }) {
  if (!blocks.length) return null
  return (
    <div className="fl-cblocks">
      {blocks.map((block, i) => {
        if (block.type === "text") {
          if (!block.heading && !block.copy) return null
          return (
            <section key={`text-${i}`} className="fl-cintro">
              {block.heading ? <h2 className="fl-cintro__title">{block.heading}</h2> : null}
              {block.copy ? <p className="fl-cintro__text">{block.copy}</p> : null}
            </section>
          )
        }

        const body = (
          <>
            {block.image ? (
              <ArtImage
                src={block.image}
                mobileSrc={block.mobile_image}
                alt=""
                sizes="(max-width: 1470px) 100vw, 1410px"
                className="fl-banner__img object-cover"
              />
            ) : null}
            <span className="fl-banner__shade" aria-hidden="true" />
            <span className="fl-banner__copy">
              {block.eyebrow ? <span className="fl-banner__eyebrow">{block.eyebrow}</span> : null}
              {block.heading ? <span className="fl-banner__title">{block.heading}</span> : null}
              {block.copy ? <span className="fl-banner__subtitle">{block.copy}</span> : null}
              {block.cta_label && block.cta_href ? (
                <span className="fl-banner__cta fl-banner__cta--accent">{block.cta_label}</span>
              ) : null}
            </span>
          </>
        )
        const className = `fl-banner${block.mobile_image ? " has-mobile" : ""}`
        return (
          <section key={`banner-${i}`}>
            {block.cta_href ? (
              <Link href={block.cta_href} className={`${className} group`}>{body}</Link>
            ) : (
              <div className={className}>{body}</div>
            )}
          </section>
        )
      })}
    </div>
  )
}
