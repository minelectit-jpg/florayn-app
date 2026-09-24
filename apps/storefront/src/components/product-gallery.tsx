"use client"

import { useState } from "react"

import DragScroll from "@/components/drag-scroll"
import ProductImage from "@/components/product-image"

export type GalleryItem = {
  id: string
  url: string
  /** Set when the item is a design-level video rather than a still. */
  video?: string | null
}

/**
 * The live gallery is a 50px thumbnail rail beside a 540px stage, 10px apart,
 * inside a 600px column. Below the lg breakpoint the rail moves under the
 * stage and runs horizontally, because 50px of rail plus a readable stage does
 * not fit a phone. There it scrolls like the other rails, with the slider bar a
 * little below the thumbnails instead of a native scrollbar touching them.
 */
export default function ProductGallery({
  items,
  label,
}: {
  items: GalleryItem[]
  /** Design name, used for the placeholder art and alt text. */
  label: string
}) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "")
  const active = items.find((item) => item.id === activeId) ?? items[0]

  if (!items.length) {
    return (
      <div className="aspect-square w-full rounded-[10px] border border-line bg-surface" />
    )
  }

  return (
    <div className="flex flex-col gap-[10px] lg:flex-row">
      {items.length > 1 ? (
        <div className="order-2 min-w-0 shrink-0 lg:order-1 lg:w-[60px]">
        <DragScroll
          className="fl-gallery-thumbs flex gap-[10px] overflow-x-auto lg:flex-col lg:overflow-visible"
          aria-label="Product images"
          indicator
        >
          {items.map((item) => {
            const isActive = item.id === active?.id
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(item.id)}
                  onMouseEnter={() => setActiveId(item.id)}
                  aria-current={isActive}
                  aria-label={item.video ? "Play video" : "Show image"}
                  className={`relative block size-[60px] overflow-hidden rounded-[8px] border transition-colors ${
                    isActive
                      ? "border-purple"
                      : "border-line hover:border-line-strong"
                  }`}
                >
                  {item.video && !item.url ? (
                    // No poster: show the clip's own first frame as the thumb.
                    <video
                      src={item.video}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ProductImage
                      src={item.url}
                      alt=""
                      label={label}
                      sizes="60px"
                    />
                  )}
                </button>
              </li>
            )
          })}
        </DragScroll>
        </div>
      ) : null}

      <div className="order-1 min-w-0 flex-1 lg:order-2">
        {active?.video ? (
          <video
            key={active.id}
            src={active.video}
            poster={active.url || undefined}
            autoPlay
            muted
            loop
            playsInline
            // No `controls`: the clip plays itself, silently.
            className="aspect-square w-full rounded-[10px] border border-line bg-surface object-contain"
          />
        ) : (
          <div data-product-hero className="relative aspect-square w-full overflow-hidden rounded-[10px] bg-surface">
            <ProductImage
              src={active?.url ?? null}
              alt={label}
              label={label}
              priority
              sizes="(max-width: 1024px) 100vw, 540px"
              fillMode="absolute"
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>
        )}
      </div>
    </div>
  )
}
