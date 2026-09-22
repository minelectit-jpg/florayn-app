"use client"
import { useState } from "react"

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
 * not fit a phone.
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
        <ul
          className="order-2 flex shrink-0 gap-[10px] overflow-x-auto lg:order-1 lg:w-[60px] lg:flex-col lg:overflow-visible"
          aria-label="Product images"
        >
          {items.map((item, index) => {
            const isActive = item.id === active?.id
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(item.id)}

                  aria-current={isActive}
                  aria-label={item.video ? "Play product video" : `Show image ${index + 1}`}
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
        </ul>
      ) : null}

      <div className="relative order-1 min-w-0 flex-1 lg:order-2">
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
          <div data-product-hero className="relative aspect-square w-full overflow-hidden rounded-[20px] border border-line bg-surface">
            <ProductImage
              src={active?.url ?? null}
              alt={label}
              label={label}
              priority
              sizes={`(max-width: 767px) calc(100vw - 30px), (max-width: 1023px) calc(100vw - 120px), (max-width: 1279px) calc(50vw - ${items.length > 1 ? 150 : 80}px), (max-width: 1419px) calc(100vw - ${items.length > 1 ? 750 : 680}px), ${items.length > 1 ? 670 : 740}px`}
              fillMode="absolute"
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>
        )}
        {items.length > 1 ? <span className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-line bg-paper/95 px-3 py-1 text-xs tabular-nums text-ink-muted">{Math.max(0, items.findIndex((item) => item.id === active?.id)) + 1} / {items.length}</span> : null}
      </div>
    </div>
  )
}
