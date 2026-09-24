import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../modules/content"

/**
 * florayn.com's published product reviews, read from its public WooCommerce
 * Store API (/wp-json/wc/store/v1/products/reviews) on 2026-09-24: all six
 * approved reviews it shows. Text is as written, without the HTML; florayn.com
 * reviews have no title.
 */
export const FLORAYN_REVIEWS = [
  { florayn_id: 6872, design_slug: "grape-goo", form: "phone", author: "Simrin Tanveeya", rating: 4, created_at: "2026-09-06T07:43:49Z", body: "I love the sleek look of the product. The color combination and pattern is just beautiful. I received the product within 3 days." },
  { florayn_id: 6021, design_slug: "sonar", form: "phone", author: "Mehedi Hasan", rating: 5, created_at: "2026-09-01T11:31:27Z", body: "Great 👍" },
  { florayn_id: 4613, design_slug: "grape-goo", form: "phone", author: "Nusraat", rating: 5, created_at: "2026-08-26T09:52:53Z", body: "Just got this phone case from florayn. It’s f’in amazing. Top noch quality, perfect finishing. You just made my day florayn😚🖤" },
  { florayn_id: 2988, design_slug: "vertigo", form: "phone", author: "Shamim", rating: 5, created_at: "2026-08-13T13:14:18Z", body: "Nice case" },
  { florayn_id: 827, design_slug: "shadow-leopard", form: "airpods", author: "Aariba Zaman", rating: 4, created_at: "2026-05-19T10:30:02Z", body: "The quality is pretty good, the case is beautiful as well. Was worth buying" },
  { florayn_id: 148, design_slug: "peppermint-twist", form: "phone", author: "Foisal", rating: 5, created_at: "2025-11-14T17:36:36Z", body: "I recently explored this new online store specializing in iPhone gadgets and was thoroughly impressed. The product catalog is well-curated, featuring high-quality accessories that cater to both functionality and aesthetics. The website interface is user-friendly, making the browsing and purchasing process seamless. Delivery was prompt, and customer support was responsive and professional. I highly recommend this shop to anyone seeking reliable and stylish iPhone accessories." },
] as const

/** The stand-in customer id of an imported review; it keeps each one unique. */
export const importedReviewCustomer = (floraynId: number) => `florayn-review-${floraynId}`

/**
 * Adds florayn.com's reviews to the matching designs, approved, with their
 * original dates. Reviews belong to a design (all its models share them), so a
 * review of "Grape Goo – iPhone 16 Pro Max" shows on every Grape Goo phone
 * page. A design missing from the store is skipped; a second run adds nothing.
 * Each one can be edited, answered or hidden under Admin > Product reviews.
 */
export default async function importFloraynReviews({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productModule: any = container.resolve(Modules.PRODUCT)
  const content: any = container.resolve(CONTENT_MODULE)
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const handles = [...new Set(FLORAYN_REVIEWS.map((r) => (r.form === "phone" ? r.design_slug : `${r.design_slug}-${r.form}`)))]
  const products: any[] = await productModule.listProducts({ handle: handles }, { select: ["id", "handle", "metadata"], take: handles.length })
  const byHandle = new Map(products.map((p) => [p.handle, p]))

  let added = 0
  for (const review of FLORAYN_REVIEWS) {
    const product = byHandle.get(review.form === "phone" ? review.design_slug : `${review.design_slug}-${review.form}`)
    if (!product || product.metadata?.design_slug !== review.design_slug) {
      logger.warn(`[florayn-reviews] ${review.design_slug} (${review.form}) is not in the store; skipped`)
      continue
    }
    const customer_id = importedReviewCustomer(review.florayn_id)
    const review_key = `design:${review.design_slug}`
    const [existing] = await content.listProductReviews({ review_key, customer_id }, { take: 1, select: ["id"] })
    if (existing) continue
    const created = await content.createProductReviews({
      review_key,
      product_id: product.id,
      customer_id,
      author: review.author,
      rating: review.rating,
      title: "",
      body: review.body,
      status: "approved",
      reply: "",
    })
    // Keep the date the customer wrote it, so the list reads in true order.
    if (knex) await knex("product_review").where({ id: created.id }).update({ created_at: new Date(review.created_at) })
    added++
  }
  logger.info(`[florayn-reviews] ${added} reviews imported`)
}
