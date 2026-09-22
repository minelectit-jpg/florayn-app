import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
export const MANUAL_RECOMMENDATIONS_KEY = "florayn_manual_recommendations"
export type ManualRecommendations = { recommended: string[]; featured: string[] }
export function manualRecommendations(raw: unknown): ManualRecommendations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Choose products for both recommendation sections.")
  const result = {} as ManualRecommendations
  for (const section of ["recommended", "featured"] as const) {
    const ids = (raw as Record<string, unknown>)[section]
    if (!Array.isArray(ids) || ids.length > 8 || ids.some((id) => typeof id !== "string" || !/^variant_[a-zA-Z0-9_-]+$/.test(id)) || new Set(ids).size !== ids.length) throw new Error("Each section supports up to 8 different product variants.")
    result[section] = ids
  }
  return result
}
export function readManualRecommendations(metadata: Record<string, unknown> | null | undefined): ManualRecommendations {
  try { return manualRecommendations(metadata?.[MANUAL_RECOMMENDATIONS_KEY]) }
  catch { return { recommended: [], featured: [] } }
}
export async function manualRecommendationRows(container: any, ids: string[]) {
  if (!ids.length) return []
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "variant", filters: { id: [...new Set(ids)].slice(0, 16) },
    fields: ["id", "title", "product_id", "metadata", "product.id", "product.title", "product.handle", "product.thumbnail", "product.status"],
  })
  return data.map((v: any) => ({
    id: v.id, title: v.title, product_id: v.product_id,
    product_title: v.product?.title, handle: v.product?.handle, status: v.product?.status,
    image: v.metadata?.images?.[0] || v.product?.thumbnail || null,
  }))
}
