"use client"

import type { FeatureBlock } from "@/lib/content"

/**
 * The admin-managed "Features" band under the gallery. Each block is a centered
 * heading and body over a looping, controls-free video (when it has a video
 * URL) or a still image. The media keeps its own aspect ratio — a 16:9 clip
 * stays 16:9 — rather than being cropped to a fixed box.
 *
 * Blocks are tagged with a group — a case type for phones, a product-type label
 * (AirPods, Sticky Pad…) for everything else. The band shows the blocks for the
 * live group; a group with none of its own falls back to the untagged (default)
 * blocks, so it follows the buy box like the gallery does.
 */
export default function FeaturesSection({
  blocks,
  group,
}: {
  blocks: FeatureBlock[]
  /** The live group, e.g. "Signature" or "AirPods". */
  group?: string
}) {
  const forGroup = group
    ? blocks.filter((b) => b.case_type === group)
    : []
  const shown = forGroup.length
    ? forGroup
    : blocks.filter((b) => !b.case_type)

  if (!shown.length) return null

  return (
    <section className="mt-12">
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <h2 className="text-center text-[1.05rem] font-semibold uppercase tracking-[0.04em]">
          Features
        </h2>
        <span className="h-px flex-1 bg-line" />
      </div>

      <ul className="mt-6 flex flex-col gap-8">
        {shown.map((block) => (
          <li key={block.id}>
            {block.title || block.description ? (
              <div className="mb-4 text-center">
                {block.title ? (
                  <h3 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.02em]">
                    {block.title}
                  </h3>
                ) : null}
                {block.description ? (
                  <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-relaxed text-ink-muted">
                    {block.description}
                  </p>
                ) : null}
              </div>
            ) : null}

            {block.video_url ? (
              <video
                src={block.video_url}
                poster={block.image_url ?? undefined}
                autoPlay
                muted
                loop
                playsInline
                // Don't pull the clip's bytes on load — this whole band is
                // lazy-mounted below the fold, and preload="none" keeps a mobile
                // visitor from ever downloading a feature video they don't reach.
                preload="none"
                // No `controls`: the video plays itself, silently. No fixed
                // aspect box or object-cover, so the clip keeps its own ratio
                // (a 16:9 video stays 16:9) instead of being cropped.
                className="block w-full rounded-[14px] bg-surface"
              />
            ) : block.image_url ? (
              <img
                src={block.image_url}
                alt={block.title ?? ""}
                loading="lazy"
                decoding="async"
                className="block w-full rounded-[14px] bg-surface"
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
