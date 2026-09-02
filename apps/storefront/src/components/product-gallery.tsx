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
          className="order-2 flex shrink-0 gap-[10px] overflow-x-auto lg:order-1 lg:w-[50px] lg:flex-col lg:overflow-visible"
          aria-label="Product images"
        >
          {items.map((item) => {
            const isActive = item.id === active?.id
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(item.id)}
                  aria-current={isActive}
                  aria-label={item.video ? "Play video" : "Show image"}
                  className={`relative block size-[50px] overflow-hidden rounded-[6px] border transition-colors ${
                    isActive
                      ? "border-purple"
                      : "border-line hover:border-line-strong"
                  }`}
                >
                  <ProductImage
                    src={item.url}
                    alt=""
                    label={label}
                    sizes="50px"
                  />
                  {item.video ? (
                    <span className="absolute inset-0 grid place-items-center bg-ink/35 text-[10px] text-white">
                      ▶
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="order-1 min-w-0 flex-1 lg:order-2">
        {active?.video ? (
          <video
            key={active.id}
            src={active.video}
            poster={active.url}
            controls
            playsInline
            className="aspect-square w-full rounded-[10px] border border-line bg-surface object-contain"
          />
        ) : (
          <div className="relative aspect-square w-full overflow-hidden rounded-[10px] border border-line bg-surface">
            <ProductImage
              src={active?.url ?? null}
              alt={label}
              label={label}
              priority
              sizes="(max-width: 1024px) 100vw, 540px"
            />
          </div>
        )}
      </div>
    </div>
  )
}
