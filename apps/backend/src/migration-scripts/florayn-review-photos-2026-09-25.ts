import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../modules/content"
import { importedReviewCustomer } from "./import-florayn-reviews-2026-09-24"

/**
 * The customer photos and "verified buyer" marks from florayn.com for the six
 * imported reviews. The photos were copied from florayn.com's review blocks
 * (public pages) to R2 under reviews/florayn/; the verified marks are
 * WooCommerce's own (the reviewer bought the product). Only a review with no
 * photos yet is given them, so an admin edit is kept; a second run changes
 * nothing.
 */
export const FLORAYN_REVIEW_EXTRAS: { florayn_id: number; verified: boolean; images: string[] }[] = [
  { florayn_id: 6872, verified: true, images: ["https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/reviews/florayn/6872-36a0cce7.webp"] },
  { florayn_id: 6021, verified: true, images: ["https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/reviews/florayn/6021-04d0c94b.webp"] },
  { florayn_id: 4613, verified: false, images: ["https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/reviews/florayn/4613-d4216d1c.webp"] },
  { florayn_id: 2988, verified: false, images: [] },
  { florayn_id: 827, verified: true, images: [] },
  { florayn_id: 148, verified: false, images: [] },
]

export default async function floraynReviewPhotos({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const content: any = container.resolve(CONTENT_MODULE)
  let changed = 0
  for (const extra of FLORAYN_REVIEW_EXTRAS) {
    const [review] = await content.listProductReviews({ customer_id: importedReviewCustomer(extra.florayn_id) }, { take: 1 })
    if (!review) continue
    const patch: Record<string, unknown> = {}
    if (extra.images.length && !(Array.isArray(review.images) && review.images.length)) patch.images = extra.images
    if (extra.verified && !review.verified) patch.verified = true
    if (!Object.keys(patch).length) continue
    await content.updateProductReviews({ id: review.id, ...patch })
    changed++
  }
  logger.info(`[florayn-review-photos] ${changed} imported reviews updated`)
}
