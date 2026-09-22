import type { StoreProduct } from "@/lib/medusa"
import type { RecommendedItem, RecommendedVariant } from "@/components/recommended-for-you"

export type RecommendationSettings = {
  phone_model: string
  phone_case_type: string
  airpods_model: string
  airpods_case_type: string
}
export const DEFAULT_RECOMMENDATIONS: RecommendationSettings = {
  phone_model: "iPhone 17 Pro Max", phone_case_type: "Signature",
  airpods_model: "AirPods Pro 3", airpods_case_type: "Signature Earbuds",
}
export function productForm(product: StoreProduct): string {
  return typeof product.metadata?.form === "string" ? product.metadata.form : "phone"
}
/** Handles follow the same design/form contract as Product Manager. */
export function designHandle(slug: string, form: string): string {
  return form === "phone" ? slug : `${slug}-${form}`
}
export function formLabel(form: string): string {
  return ({ phone: "Phone Case", airpods: "AirPods Case", wallet: "Wallet", watch: "Watch Band", card: "Card Holder" } as Record<string, string>)[form] ?? "Accessory"
}
export function recommendationVariants(product: StoreProduct, settings: RecommendationSettings): RecommendedVariant[] {
  const form = productForm(product)
  const preferredCase = form === "phone" ? settings.phone_case_type : settings.airpods_case_type
  const preferredModel = form === "phone" ? settings.phone_model : settings.airpods_model
  const deviceId = product.options?.find((o) => o.title.toLowerCase() === "device")?.id
  const caseId = product.options?.find((o) => o.title.toLowerCase() === "case type")?.id
  const byModel = new Map<string, RecommendedVariant>()
  for (const variant of product.variants ?? []) {
    const model = variant.options?.find((o) => o.option_id === deviceId)?.value
    const caseType = variant.options?.find((o) => o.option_id === caseId)?.value ?? ""
    const price = variant.calculated_price?.calculated_amount
    if (!model || typeof price !== "number" || price <= 0) continue
    const previous = byModel.get(model)
    if (previous && (previous.caseType === preferredCase || (caseType !== preferredCase && (previous.price ?? Infinity) <= price))) continue
    const images = variant.metadata?.images
    const image = Array.isArray(images) && typeof images[0] === "string" ? images[0] : null
    const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    byModel.set(model, { id: variant.id, label: model, caseType, price, image,
      href: `/product/${product.handle}-${slug(model)}/?case=${slug(caseType)}` })
  }
  return [...byModel.values()].sort((a, b) => {
    if (a.label === preferredModel) return -1
    if (b.label === preferredModel) return 1
    // Natural, descending model order is a deterministic fallback, never an
    // invented variant. The owner's chosen model always takes precedence.
    return b.label.localeCompare(a.label, "en", { numeric: true })
  })
}
export function recommendationItem(product: StoreProduct, settings: RecommendationSettings): RecommendedItem | null {
  const variants = recommendationVariants(product, settings)
  if (!variants.length) return null
  return { id: product.id, name: String(product.metadata?.design_name ?? product.title),
    handle: product.handle, thumbnail: variants[0].image, formLabel: formLabel(productForm(product)),
    price: variants[0].price, variants }
}
