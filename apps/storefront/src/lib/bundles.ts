/**
 * Multi-buy tiers, read from the backend so they can be edited in the admin
 * without a deploy.
 */

const BACKEND =
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

export type BundleTier = {
  id: string
  quantity: number
  badge: string | null
  discount_amount: number
  min_pct: number
  max_pct: number
}

export type BundleSettings = {
  heading: string
  single_label: string
  free_shipping_threshold: number
  scope: string
  is_active: boolean
}

export type BundleConfig = {
  settings: BundleSettings
  tiers: BundleTier[]
}

/**
 * The clamp, mirrored from the backend's modules/bundles/pricing.ts. That copy
 * is the authority - checkout recomputes there and ignores the client - but
 * the widget has to price whichever device is selected, so it cannot ask the
 * server on every change.
 */
export function tierPricing(unitPrice: number, tier: BundleTier) {
  const quantity = Math.max(1, Math.round(tier.quantity))
  const subtotal = unitPrice * quantity

  let discount = Math.max(0, Math.round(tier.discount_amount))

  if (tier.min_pct > 0) {
    const floor = Math.round((subtotal * tier.min_pct) / 100)
    if (discount < floor) discount = floor
  }
  if (tier.max_pct > 0) {
    const ceiling = Math.round((subtotal * tier.max_pct) / 100)
    if (discount > ceiling) discount = ceiling
  }
  if (discount > subtotal) discount = subtotal

  return { quantity, subtotal, discount, total: subtotal - discount }
}

export async function getBundleConfig(): Promise<BundleConfig | null> {
  try {
    const res = await fetch(`${BACKEND}/store/bundles`, {
      headers: { "x-publishable-api-key": KEY },
      // Tiers change rarely and are edited in the admin, so a short revalidate
      // keeps the product page fast without going stale for long.
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return (await res.json()) as BundleConfig
  } catch {
    return null
  }
}
