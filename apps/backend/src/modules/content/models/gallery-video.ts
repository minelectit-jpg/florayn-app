import { model } from "@medusajs/framework/utils"

/**
 * A video shown in a product's gallery, keyed by design + case type and shared
 * across every device (a 16 Pro Max and an S24 of the same design/case type see
 * the same clip). The owner fills these two ways: from the Gallery videos admin
 * screen, or by dropping `<design>/<case-type>/video.mp4` in the File manager
 * and running a scan — both write here.
 *
 * `case_type` holds the case type's display name (e.g. "Signature"), matching
 * the storefront's live case-type value.
 */
const GalleryVideo = model.define("gallery_video", {
  id: model.id({ prefix: "galvid" }).primaryKey(),
  design_slug: model.text(),
  case_type: model.text(),
  video_url: model.text(),
  /** Optional thumbnail; when empty the clip's own first frame is used. */
  poster_url: model.text().nullable(),
  /** 1-based slot among the gallery images; clamped to the image count. */
  position: model.number().default(1),
})

export default GalleryVideo
