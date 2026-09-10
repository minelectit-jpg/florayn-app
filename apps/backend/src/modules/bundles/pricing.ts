/**
 * Multi-buy arithmetic.
 *
 * A tier carries a flat discount, but that flat amount is clamped to a
 * percentage band of the subtotal so one figure can serve case types priced
 * from 1,400৳ to 3,800৳. Take the flat amount; if it lands below `min_pct` of
 * the subtotal use the floor instead, and if it lands above `max_pct` use the
 * ceiling.
 *
 * Worked example, Armor Black at 1,950৳ with tier 1 (flat 300৳, 8-12%):
 *   subtotal 3,900৳, flat 300৳ is 7.7% - under the 8% floor,
 *   so the discount becomes 312৳ and the customer pays 3,588৳.
 *
 * The storefront mirrors this function to render the pills. This copy is the
 * authority: checkout recomputes with it and ignores whatever the client sent.
 */

export type TierInput = {
  quantity: number
  discount_amount: number
  min_pct: number
  max_pct: number
}

export type TierPricing = {
  quantity: number
  subtotal: number
  discount: number
  total: number
  /** Discount as a percentage of subtotal, rounded to one decimal. */
  discount_pct: number
  /** Which rule set the discount, useful in the admin preview. */
  applied: "flat" | "min_pct" | "max_pct"
}

export function tierPricing(unitPrice: number, tier: TierInput): TierPricing {
  const quantity = Math.max(1, Math.round(tier.quantity))
  const subtotal = unitPrice * quantity

  let discount = Math.max(0, Math.round(tier.discount_amount))
  let applied: TierPricing["applied"] = "flat"

  if (tier.min_pct > 0) {
    const floor = Math.round((subtotal * tier.min_pct) / 100)
    if (discount < floor) {
      discount = floor
      applied = "min_pct"
    }
  }

  // A zero ceiling means the tier is uncapped.
  if (tier.max_pct > 0) {
    const ceiling = Math.round((subtotal * tier.max_pct) / 100)
    if (discount > ceiling) {
      discount = ceiling
      applied = "max_pct"
    }
  }

  // Never discount past free.
  if (discount > subtotal) {
    discount = subtotal
  }

  return {
    quantity,
    subtotal,
    discount,
    total: subtotal - discount,
    discount_pct: subtotal
      ? Math.round((discount / subtotal) * 1000) / 10
      : 0,
    applied,
  }
}

/**
 * The discount on one cart line.
 *
 * A tier is a pack, so the discount repeats: with a 3-pack tier, six items are
 * two packs and take the discount twice, and a seventh item is at standard
 * price. The largest tier that fits wins, which is always at least as good for
 * the customer as a smaller one.
 *
 * The clamp is evaluated per pack, never against the whole line - otherwise a
 * big order would drag the percentage floor up and quietly widen the discount.
 */
export function lineDiscount(
  unitPrice: number,
  quantity: number,
  tiers: TierInput[]
): { discount: number; tier: TierInput | null; packs: number } {
  const tier = tiers
    .filter((t) => t.quantity > 1 && quantity >= t.quantity)
    .sort((a, b) => b.quantity - a.quantity)[0]

  if (!tier) {
    return { discount: 0, tier: null, packs: 0 }
  }

  const packs = Math.floor(quantity / tier.quantity)
  const perPack = tierPricing(unitPrice, tier).discount

  return { discount: perPack * packs, tier, packs }
}

export type CartLine = {
  unit_price: number
  quantity: number
  /** A phone case. When the bundle scope is "cases", only these are counted. */
  is_case: boolean
}

/**
 * The whole-cart multi-buy discount, with scope applied.
 *
 * "cases" means the multi-buy is a phone-case promotion: an AirPods case, a
 * wallet or a watch band pays standard price no matter how many are bought.
 * Any other scope counts every line. Kept pure and separate from the cart
 * plumbing in apply.ts so this rule is unit-tested rather than trusted.
 */
export function cartBundleDiscount(
  lines: CartLine[],
  tiers: TierInput[],
  opts: { scope: string }
): number {
  let discount = 0
  for (const line of lines) {
    const unit = Number(line.unit_price ?? 0)
    const qty = Number(line.quantity ?? 0)
    if (!unit || qty < 2) continue
    if (opts.scope === "cases" && !line.is_case) continue
    discount += lineDiscount(unit, qty, tiers).discount
  }
  return discount
}
