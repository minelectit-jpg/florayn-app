"use client"

import Image from "next/image"
import { useState } from "react"

/**
 * Product imagery that cannot render as an empty box.
 *
 * Three cases are handled: no image at all, an inline SVG data URI (what the
 * seed produces), and a real remote image. A remote image that fails to load -
 * an unreachable host, a dead URL - falls back to the same tinted block rather
 * than leaving a hole in the grid, which is how the picsum outage showed up.
 */
export default function ProductImage({
  src,
  alt,
  label,
  sizes,
  priority,
  className = "",
}: {
  src?: string | null
  alt: string
  /** Used for the initials shown when there is nothing to render. */
  label?: string
  sizes?: string
  priority?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <ImageFallback label={label ?? alt} className={className} />
  }

  // next/image cannot optimise data URIs, and there is nothing to optimise.
  if (src.startsWith("data:")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover ${className}`}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  )
}

function hashOf(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function ImageFallback({
  label,
  className = "",
}: {
  label: string
  className?: string
}) {
  const hash = hashOf(label)
  // Kept inside a narrow band around Florayn Purple at low saturation. A full
  // rainbow of placeholder tiles reads playful; the brand is premium minimal,
  // so these stay close to the palette and differ mostly in value.
  const hue = 252 + ((hash % 40) - 20)
  const lightness = 26 + (hash % 10)
  const initials = label
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")

  return (
    <div
      role="img"
      aria-label={label}
      className={`absolute inset-0 flex items-center justify-center ${className}`}
      style={{
        backgroundImage: `linear-gradient(145deg, hsl(${hue} 18% ${lightness + 22}%), hsl(${hue} 24% ${lightness}%))`,
      }}
    >
      <span className="display text-3xl tracking-wide text-white/85">
        {initials}
      </span>
    </div>
  )
}
