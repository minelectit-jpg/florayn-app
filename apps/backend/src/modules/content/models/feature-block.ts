import { model } from "@medusajs/framework/utils"

/**
 * One block in the product page's "Features" band, below the recommendations.
 * The owner builds these from the admin: each block is either a looping video
 * (autoplaying, no controls) or a still image, with an optional heading and
 * body. Order and visibility are data, so blocks reorder or hide without a
 * deploy.
 *
 * A block renders as a video when `video_url` is set, otherwise as an image.
 */
const FeatureBlock = model.define("feature_block", {
  id: model.id({ prefix: "featblk" }).primaryKey(),
  /**
   * The case type (construction) this block belongs to, e.g. "Signature" or
   * "Armor Black" — the same value the storefront's case-type selector uses.
   * Null means it shows for any case type that has no blocks of its own.
   */
  case_type: model.text().nullable(),
  title: model.text().nullable(),
  description: model.text().nullable(),
  /** Still image; used when there is no video, and as the video's poster. */
  image_url: model.text().nullable(),
  /** When set, the block plays this on loop, muted, with no controls. */
  video_url: model.text().nullable(),
  position: model.number().default(0),
  is_visible: model.boolean().default(true),
})

export default FeatureBlock
