"use server"
import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa"
import { getCustomerToken } from "./customer"
import type { ReviewPage } from "./product-reviews"

export type ReviewInput = { author: string; rating: number; title: string; body: string; images?: string[] }
export type ReviewReward = { code: string; pct: number }
export type SubmitResult =
  | { ok: true; status: "approved" | "pending"; reward: ReviewReward | null; pendingRewardPct: number | null }
  | { ok: false; signIn?: boolean; error: string }

export type ReviewProgramInfo = {
  max_photos: number
  rewards: { photo_pct: number; text_pct: number } | null
  auto_approve: boolean
  invite: {
    name: string | null
    product_ids: string[]
    designs: string[]
    products?: { id: string; handle: string; title: string; thumbnail: string | null }[]
  } | null
  invite_invalid: boolean
}

/** Who is writing: a signed-in customer (Bearer) or a review request link (token). */
async function authHeaders(reviewToken?: string): Promise<Record<string, string> | null> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY }
  if (reviewToken) return headers
  const token = await getCustomerToken()
  if (!token) return null
  return { ...headers, authorization: `Bearer ${token}` }
}

/**
 * Submit a review. With a review link (`reviewToken`) no sign-in is needed:
 * the link itself proves the order. The answer says whether it is published
 * and, if so, the discount code it earned.
 */
export async function submitReview(productId: string, input: ReviewInput, reviewToken?: string): Promise<SubmitResult> {
  const headers = await authHeaders(reviewToken)
  if (!headers) return { ok: false, signIn: true, error: "Sign in to share your review." }
  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-reviews`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000), headers,
      body: JSON.stringify({ ...input, product_id: productId, ...(reviewToken ? { token: reviewToken } : {}) }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const signIn = response.status === 401 || (reviewToken ? response.status === 403 : false)
      return { ok: false, signIn, error: response.status === 401 && !reviewToken ? "Sign in again to share your review." : data.message || "Could not submit your review. Please try again." }
    }
    return { ok: true, status: data.status === "approved" ? "approved" : "pending", reward: data.reward ?? null, pendingRewardPct: data.pending_reward_pct ?? null }
  } catch { return { ok: false, error: "We could not confirm your submission. Try again; duplicate reviews will not be added." } }
}

/** One photo, already shrunk in the browser, stored for the review. */
export async function uploadReviewPhoto(image: string, reviewToken?: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (typeof image !== "string" || !image.startsWith("data:image/") || image.length > 11_000_000) return { ok: false, error: "Choose a photo under 8 MB." }
  const headers = await authHeaders(reviewToken)
  if (!headers) return { ok: false, error: "Sign in to add photos." }
  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-reviews/photos`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000), headers,
      body: JSON.stringify({ image, ...(reviewToken ? { token: reviewToken } : {}) }),
    })
    const data = await response.json().catch(() => ({}))
    return response.ok && typeof data.url === "string" ? { ok: true, url: data.url } : { ok: false, error: data.message || "That photo could not be added." }
  } catch { return { ok: false, error: "That photo could not be added. Please try again." } }
}

/** What the review form offers (photos, reward) and, for a review link, who it is for. */
export async function getReviewProgram(reviewToken?: string): Promise<ReviewProgramInfo | null> {
  try {
    const query = reviewToken ? `?token=${encodeURIComponent(reviewToken)}` : ""
    const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-reviews/program${query}`, {
      cache: "no-store", headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000),
    })
    return response.ok ? await response.json() : null
  } catch { return null }
}

export async function loadReviewPage(productId: string, offset: number): Promise<ReviewPage | null> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return null
  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-reviews?product_id=${encodeURIComponent(productId)}&offset=${offset}`, { cache: "no-store", headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000) })
    return response.ok ? await response.json() : null
  } catch { return null }
}
