import ProductImage from "@/components/product-image"
import type { FeatureBlock } from "@/lib/content"

/**
 * The admin-managed "Features" band under the gallery. Each block is a looping,
 * controls-free video (when it has a video URL) or a still image, with an
 * optional heading and body. Blocks stack vertically — media on top, copy
 * below — so the band reads cleanly in the gallery column rather than spanning
 * the full page.
 */
export default function FeaturesSection({
  blocks,
}: {
  blocks: FeatureBlock[]
}) {
  if (!blocks.length) return null

  return (
    <section className="mt-12">
      <h2 className="text-[1.125rem] font-semibold tracking-[-0.034em]">
        Features
      </h2>

      <ul className="mt-4 flex flex-col gap-8">
        {blocks.map((block) => (
          <li key={block.id}>
            <div className="overflow-hidden rounded-[14px] bg-surface">
              {block.video_url ? (
                <video
                  src={block.video_url}
                  poster={block.image_url ?? undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  // No `controls`: the video plays itself, silently.
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="relative aspect-[4/3] w-full">
                  <ProductImage
                    src={block.image_url}
                    alt={block.title ?? ""}
                    label={block.title ?? "Feature"}
                    sizes="(max-width: 1023px) 100vw, 600px"
                    fillMode="absolute"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              )}
            </div>

            {block.title || block.description ? (
              <div className="mt-3">
                {block.title ? (
                  <h3 className="text-[1.05rem] font-semibold leading-tight tracking-[-0.01em]">
                    {block.title}
                  </h3>
                ) : null}
                {block.description ? (
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
                    {block.description}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
