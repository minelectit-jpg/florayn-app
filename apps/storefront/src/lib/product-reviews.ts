import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa"
export type Review = { id: string; author: string; rating: number; title: string; body: string; reply: string; created_at: string; images?: string[]; verified?: boolean }
export type ReviewPage = { reviews: Review[]; count: number; average: number | null; distribution: number[]; offset: number; limit: number }
export async function getProductReviews(productId: string): Promise<ReviewPage | null> {
  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-reviews?product_id=${encodeURIComponent(productId)}`, {
      headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY },
      next: { revalidate: 60, tags: ["content", "products", `reviews:${productId}`] },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    return await response.json()
  } catch { return null }
}

