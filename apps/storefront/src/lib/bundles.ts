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
  badge_text?: string
  heading: string
  single_label: string
  free_shipping_threshold: number
  scope: string
  is_active: boolean
  /**
   * "Matching Set" bundle (a design across forms, e.g. phone + AirPods). Optional
   * so an older backend without these columns still parses; the widget falls
   * back to sensible defaults until the admin sets them.
   */
  matching_set_enabled?: boolean
  matching_set_title?: string
  matching_set_subtitle?: string
  /** Flat BDT taken off the phone + AirPods subtotal. */
  matching_set_discount?: number
  /** The AirPods model preselected in the bundle (device name). */
  matching_set_default_airpods?: string
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

/** A cart line reduced to what the bundle maths needs. */
export type BundleLine = {
  unit_price: number
  quantity: number
  is_case: boolean
  form?: string
  design?: string
}

function lineDiscountMirror(
  unitPrice: number,
  quantity: number,
  tiers: BundleTier[]
): number {
  const tier = tiers
    .filter((t) => t.quantity > 1 && quantity >= t.quantity)
    .sort((a, b) => b.quantity - a.quantity)[0]
  if (!tier) return 0
  const packs = Math.floor(quantity / tier.quantity)
  return tierPricing(unitPrice, tier).discount * packs
}

/**
 * The whole-cart discount, mirroring modules/bundles/pricing.ts so the cart and
 * checkout can show the saving before the order is placed. The backend recomputes
 * and owns the real promotion; this is only for display.
 */
export function cartDiscount(
  lines: BundleLine[],
  config: BundleConfig | null
): number {
  if (!config || !config.settings.is_active) return 0
  const s = config.settings

  // Packs: aggregate the eligible case quantity, then the tier repeats at the
  // average unit price.
  let q = 0
  let subtotal = 0
  for (const l of lines) {
    const u = Number(l.unit_price ?? 0)
    const qty = Number(l.quantity ?? 0)
    if (!u || qty < 1) continue
    if (s.scope === "cases" && !l.is_case) continue
    q += qty
    subtotal += u * qty
  }
  let discount = q >= 2 ? lineDiscountMirror(subtotal / q, q, config.tiers) : 0

  // Matching Set: a phone case + AirPods case of one design.
  if ((s.matching_set_enabled ?? true) && (s.matching_set_discount ?? 250) > 0) {
    const phones = new Map<string, number>()
    const airpods = new Map<string, number>()
    for (const l of lines) {
      const qty = Number(l.quantity ?? 0)
      if (qty < 1 || !l.design) continue
      if (l.form === "airpods") {
        airpods.set(l.design, (airpods.get(l.design) ?? 0) + qty)
      } else if (l.form === "phone" || l.is_case) {
        phones.set(l.design, (phones.get(l.design) ?? 0) + qty)
      }
    }
    let pairs = 0
    for (const [design, count] of phones) {
      pairs += Math.min(count, airpods.get(design) ?? 0)
    }
    discount += pairs * Math.round(s.matching_set_discount ?? 250)
  }

  return discount
}

export async function getBundleConfig(): Promise<BundleConfig | null> {
  try {
    const res = await fetch(`${BACKEND}/store/bundles`, {
      headers: { "x-publishable-api-key": KEY },
      // Tiers change rarely and are edited in the admin, so a short revalidate
      // keeps the product page fast without going stale for long.
      next: { revalidate: 60, tags: ["bundles"] },
    })
    if (!res.ok) return null
    return (await res.json()) as BundleConfig
  } catch {
    return null
  }
}


// Never advertise a larger whole percentage than the configured offer saves.
export function savingsPercent(quotes: { subtotal: number; discount: number }[]): number {
  return Math.floor(Math.max(0, ...quotes.map(({ subtotal, discount }) =>
    subtotal > 0 && Number.isFinite(subtotal) && Number.isFinite(discount)
      ? Math.min(100, Math.max(0, discount / subtotal * 100)) : 0)) + 1e-8)
}
