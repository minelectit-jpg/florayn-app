import { getImageProps } from "next/image"

/*
 * Only these hosts go through the Next optimizer (next.config.ts
 * remotePatterns). An admin can paste any https image; anything else is
 * served as-is rather than failing the optimizer.
 */
const OPTIMIZED = /^https:\/\/(?:[a-z0-9-]+\.)*r2\.dev\/|^https:\/\/img\.florayn\.com\//i

export function canOptimize(src: string): boolean {
  return OPTIMIZED.test(src)
}

/**
 * Campaign imagery with art direction: a separate (usually portrait) crop
 * below 768px, chosen by the browser through <picture>, so a phone downloads
 * one image instead of both. Fills its positioned parent.
 *
 * Plain markup with no state, so it renders the same on the server and in a
 * client component, and never needs hydrating to show.
 */
export default function ArtImage({
  src,
  mobileSrc,
  alt,
  sizes = "100vw",
  mobileSizes = "100vw",
  priority = false,
  className = "object-cover",
}: {
  src: string
  mobileSrc?: string | null
  alt: string
  sizes?: string
  mobileSizes?: string
  priority?: boolean
  className?: string
}) {
  const mobile = mobileSrc && mobileSrc !== src ? mobileSrc : null

  if (!canOptimize(src)) {
    return (
      <picture>
        {mobile ? <source media="(max-width: 767px)" srcSet={mobile} /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className={`absolute inset-0 h-full w-full ${className}`}
        />
      </picture>
    )
  }

  const common = { alt, fill: true as const, quality: 80, priority }
  const { props: desktop } = getImageProps({ ...common, src, sizes })
  const small = mobile
    ? canOptimize(mobile)
      ? getImageProps({ ...common, src: mobile, sizes: mobileSizes }).props
      : { srcSet: mobile, sizes: undefined }
    : null

  return (
    <picture>
      {small ? (
        <source media="(max-width: 767px)" srcSet={small.srcSet} sizes={small.sizes} />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...desktop} alt={alt} className={className} />
    </picture>
  )
}
