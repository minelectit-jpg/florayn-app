"use server"
import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa"
import { getCustomerToken } from "./customer"
import type { ReviewPage } from "./product-reviews"

export async function submitReview(productId: string, input: { author: string; rating: number; title: string; body: string }) {
  const token = await getCustomerToken()
  if (!token) return { ok: false, signIn: true, error: "Sign in to share your review." }
  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-reviews`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...input, product_id: productId }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, signIn: response.status === 401, error: response.status === 401 ? "Sign in again to share your review." : data.message || "Could not submit your review. Please try again." }
    return { ok: true }
  } catch { return { ok: false, error: "We could not confirm your submission. Try again; duplicate reviews will not be added." } }
}
export async function loadReviewPage(productId: string, offset: number): Promise<ReviewPage | null> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return null
  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-reviews?product_id=${encodeURIComponent(productId)}&offset=${offset}`, { cache: "no-store", headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000) })
    return response.ok ? await response.json() : null
  } catch { return null }
}

