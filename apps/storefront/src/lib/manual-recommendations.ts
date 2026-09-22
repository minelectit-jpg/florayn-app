import type { RecommendedItem } from "@/components/recommended-for-you"
import { getRegionId, MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY, type StoreVariant } from "@/lib/medusa"

type Choice = StoreVariant & { product?: { id: string; title: string; handle: string; thumbnail?: string | null } }
export function manualRecommendationItems(ids: string[], variants: Choice[]): RecommendedItem[] {
  const byId = new Map(variants.map((v) => [v.id, v]))
  return ids.flatMap((id) => {
    const variant = byId.get(id)
    const p = variant?.product
    const amount = variant?.calculated_price?.calculated_amount
    if (!p || typeof amount !== "number" || !Number.isFinite(amount)) return []
    const image = (variant.metadata?.images as string[] | undefined)?.[0] || p.thumbnail || null
    return [{
      id, name: p.title, handle: p.handle, thumbnail: image, formLabel: variant.title, price: amount,
      variants: [{ id, label: variant.title, price: amount, image, href: `/product/${p.handle}/?variant=${encodeURIComponent(id)}` }],
    }]
  })
}
export async function getManualRecommendations(metadata: Record<string, unknown> | null | undefined) {
  const raw = metadata?.florayn_manual_recommendations as Record<string, unknown> | undefined
  const ids = (key: string): string[] => Array.isArray(raw?.[key])
    ? [...new Set((raw[key] as unknown[]).filter((id): id is string => typeof id === "string" && /^variant_[a-zA-Z0-9_-]+$/.test(id)))].slice(0, 8) : []
  const recommended = ids("recommended"), featured = ids("featured")
  const all = [...new Set([...recommended, ...featured])]
  if (!all.length) return { recommended: [], featured: [] }
  const region = await getRegionId()
  if (!region) return { recommended: [], featured: [] }
  const params = new URLSearchParams({ limit: String(all.length), region_id: region, fields: "id,title,metadata,calculated_price.calculated_amount,calculated_price.currency_code,product.id,product.title,product.handle,product.thumbnail" })
  for (const id of all) params.append("id[]", id)
  const response = await fetch(`${MEDUSA_BACKEND_URL}/store/product-variants?${params}`, {
    headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY },
    next: { revalidate: 600, tags: ["products"] },
  })
  // Fail an ISR refresh instead of caching an incomplete recommendation list.
  if (!response.ok) throw new Error(`Recommendation variants unavailable (${response.status})`)
  const { variants } = await response.json() as { variants: Choice[] }
  return { recommended: manualRecommendationItems(recommended, variants), featured: manualRecommendationItems(featured, variants) }
}
