import { randomBytes } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { putObject } from "../../../../lib/r2"
import { readReviewToken } from "../../../../lib/review-links"
import { imageType } from "../../../../lib/review-photos"

const MAX_BYTES = 8 * 1024 * 1024

/**
 * POST /store/product-reviews/photos { image: "data:image/...;base64,..." , token? }
 * One review photo, from a signed-in customer or a review request link. The
 * storefront shrinks it first (about 1600px); here it must be a real JPEG, PNG
 * or WebP under 8 MB. Stored in R2 under reviews/ and returned as a URL.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (!req.auth_context?.actor_id && !readReviewToken(body.token)) { res.status(401).json({ message: "Sign in or use your review link to add photos." }); return }
  const match = typeof body.image === "string" ? body.image.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/) : null
  if (!match) { res.status(400).json({ message: "Choose a photo." }); return }
  const bytes = Buffer.from(match[1], "base64")
  if (bytes.length > MAX_BYTES) { res.status(413).json({ message: "Keep each photo under 8 MB." }); return }
  const kind = imageType(bytes)
  if (!kind) { res.status(400).json({ message: "Use a JPEG, PNG or WebP photo." }); return }
  const now = new Date()
  const key = `reviews/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomBytes(12).toString("hex")}.${kind.ext}`
  const { url } = await putObject(key, bytes, kind.type)
  res.status(201).json({ url })
}
