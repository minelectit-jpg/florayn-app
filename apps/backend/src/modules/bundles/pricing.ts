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
  /** Product form ("phone" | "airpods" | ...), for the Matching Set pairing. */
  form?: string
  /** Design slug, so a phone case and an AirPods case can be matched as a set. */
  design?: string
}

/**
 * The whole-cart multi-buy discount, with scope applied.
 *
 * The pack is a whole-cart tier: every eligible case counts toward one total,
 * so two different designs (two lines of one each) are a 2-pack just as two of
 * the same design are. The tier discount then repeats over that total at the
 * average unit price - the clamp still runs per pack, so a big order does not
 * drag the percentage floor up.
 *
 * "cases" means the multi-buy is a phone-case promotion: an AirPods case, a
 * wallet or a watch band pays standard price. Any other scope counts every
 * line. Kept pure and separate from the cart plumbing in apply.ts so this rule
 * is unit-tested rather than trusted.
 */
export function cartBundleDiscount(
  lines: CartLine[],
  tiers: TierInput[],
  opts: { scope: string }
): number {
  let totalQty = 0
  let totalSubtotal = 0
  for (const line of lines) {
    const unit = Number(line.unit_price ?? 0)
    const qty = Number(line.quantity ?? 0)
    if (!unit || qty < 1) continue
    if (opts.scope === "cases" && !line.is_case) continue
    totalQty += qty
    totalSubtotal += unit * qty
  }
  if (totalQty < 2) return 0
  const avgUnit = totalSubtotal / totalQty
  return lineDiscount(avgUnit, totalQty, tiers).discount
}

export type MatchingSetInput = {
  enabled: boolean
  /** Flat BDT taken off each phone + AirPods pair of one design. */
  discount: number
}

/**
 * The "Matching Set" bundle discount: a phone case and an AirPods case of the
 * SAME design, bought together, take a flat saving. Each matched pair earns it
 * once, so a cart with two phones and one AirPods of a design gets it a single
 * time. Recomputed from the cart, never trusted from the client.
 */
export function matchingSetDiscount(
  lines: CartLine[],
  opts: MatchingSetInput
): number {
  if (!opts.enabled || opts.discount <= 0) return 0

  const phones = new Map<string, number>()
  const airpods = new Map<string, number>()
  for (const line of lines) {
    const qty = Number(line.quantity ?? 0)
    if (qty < 1 || !line.design) continue
    if (line.form === "airpods") {
      airpods.set(line.design, (airpods.get(line.design) ?? 0) + qty)
    } else if (line.form === "phone" || line.is_case) {
      phones.set(line.design, (phones.get(line.design) ?? 0) + qty)
    }
  }

  let pairs = 0
  for (const [design, count] of phones) {
    pairs += Math.min(count, airpods.get(design) ?? 0)
  }
  return pairs * Math.max(0, Math.round(opts.discount))
}
