import { MedusaError } from "@medusajs/framework/utils"

export const PRODUCT_CONTENT_KEY = "florayn_product_content"
export type ProductContent = {
  description_heading: string; information_heading: string; faq_heading: string
  reviews_heading: string; reviews_intro: string; reviews_enabled: boolean
  facts: { label: string; value: string }[] | null
  faqs: { question: string; answer: string }[] | null
}
export const DEFAULT_PRODUCT_CONTENT: ProductContent = {
  description_heading: "Made for your everyday",
  information_heading: "Product details",
  faq_heading: "Good to know",
  reviews_heading: "Customer reviews",
  reviews_intro: "Real experiences, shared by our customers.",
  reviews_enabled: true, facts: null, faqs: null,
}
export function productContent(raw: unknown): ProductContent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product content is required.")
  const input = raw as Record<string, unknown>
  const out = { ...DEFAULT_PRODUCT_CONTENT }
  for (const key of ["description_heading", "information_heading", "faq_heading", "reviews_heading", "reviews_intro"] as const) {
    const value = input[key]
    if (typeof value !== "string" || !value.trim() || value.length > (key === "reviews_intro" ? 300 : 80)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Use non-empty headings up to 80 characters and a review introduction up to 300.")
    out[key] = value.trim()
  }
  if (typeof input.reviews_enabled !== "boolean") throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose whether to show reviews.")
  out.reviews_enabled = input.reviews_enabled
  for (const [key, left, right, max, leftLimit, rightLimit] of [
    ["facts", "label", "value", 16, 80, 500], ["faqs", "question", "answer", 12, 200, 2000],
  ] as const) {
    const rows = input[key]
    if (rows === null) { out[key] = null; continue }
    if (!Array.isArray(rows) || rows.length > max) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Use up to ${max} ${key}.`)
    const seen = new Set<string>()
    const parsed = rows.map((row: any) => {
      if (typeof row?.[left] !== "string" || !row[left].trim() || row[left].length > leftLimit || typeof row[right] !== "string" || !row[right].trim() || row[right].length > rightLimit) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Complete every ${key} row within its text limits.`)
      const label = row[left].trim()
      if (seen.has(label.toLowerCase())) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Use distinct labels and questions.")
      seen.add(label.toLowerCase())
      return { [left]: label, [right]: row[right].trim() }
    })
    ;(out as any)[key] = parsed
  }
  return out
}
export function readProductContent(metadata: Record<string, unknown> | null | undefined): ProductContent {
  try { return productContent(metadata?.[PRODUCT_CONTENT_KEY]) } catch { return { ...DEFAULT_PRODUCT_CONTENT } }
}

