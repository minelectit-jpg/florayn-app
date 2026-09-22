import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../modules/content"
import { readProductContent } from "./product-content"

export async function reviewProduct(container: any, productId: string, published = true) {
  if (typeof productId !== "string" || !productId || productId.length > 100) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose a product.")
  const product = await container.resolve(Modules.PRODUCT).retrieveProduct(productId, { select: ["id", "title", "status", "metadata"] })
  if (published && (product.status !== "published" || !readProductContent(product.metadata).reviews_enabled)) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Reviews are unavailable for this product.")
  const design = product.metadata?.design_slug
  return { product, key: typeof design === "string" && design ? `design:${design}` : `product:${product.id}` }
}
export function reviewInput(raw: any) {
  if (!raw || !Number.isInteger(raw.rating) || raw.rating < 1 || raw.rating > 5) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose a rating from 1 to 5.")
  const limits = { author: [2, 60], title: [3, 120], body: [10, 3000] }
  const result: any = { rating: raw.rating }
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = typeof raw[key] === "string" ? raw[key].trim() : ""
    if (value.length < min || value.length > max) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Keep ${key === "author" ? "your display name" : key} between ${min} and ${max} characters.`)
    result[key] = value
  }
  if (result.author.includes("@")) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Use a display name rather than your email address.")
  return result as { rating: number; author: string; title: string; body: string }
}
export function publicReview(row: any) {
  return { id: row.id, author: row.author, rating: row.rating, title: row.title, body: row.body, reply: row.reply, created_at: row.created_at }
}
export async function publicReviews(container: any, productId: string, offset = 0) {
  const { key } = await reviewProduct(container, productId)
  const service = container.resolve(CONTENT_MODULE)
  const filter = { review_key: key, status: "approved" }
  const [rows, counts] = await Promise.all([
    service.listProductReviews(filter, { take: 6, skip: offset, order: { created_at: "DESC", id: "DESC" } }),
    Promise.all([1, 2, 3, 4, 5].map(async (rating) => {
      const [, count] = await service.listAndCountProductReviews({ ...filter, rating }, { take: 1, select: ["id"] })
      return count as number
    })),
  ])
  const count = counts.reduce((a, b) => a + b, 0)
  return { reviews: rows.map(publicReview), count, average: count ? counts.reduce((sum, n, i) => sum + n * (i + 1), 0) / count : null, distribution: counts, offset, limit: 6 }
}

