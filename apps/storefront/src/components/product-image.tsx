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
  const hue = hash % 360
  const hue2 = (hue + 40 + (hash % 60)) % 360
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
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 48% 64%), hsl(${hue2} 42% 34%))`,
      }}
    >
      <span className="display text-3xl text-white/90">
        {initials}
      </span>
    </div>
  )
}
