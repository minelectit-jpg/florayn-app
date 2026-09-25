import type { BundleConfig } from "@/lib/bundles"
import { formatPrice } from "@/lib/money"

/**
 * The product page's buy buttons, the parts worth testing on their own
 * (components/product-buy-box.tsx uses them).
 */

/** The most a shopper can pick: live stock (untracked stock = 99), never below 1. */
export function maxQuantity(available: number): number {
  if (!Number.isFinite(available)) return 99
  return Math.min(99, Math.max(1, Math.floor(available)))
}

/**
 * How many Buy it now should add. A shopper who already added this case on
 * this page and then taps Buy it now means "buy it", not "buy another": only
 * the part not yet in the bag is added (0 = straight to checkout). A line
 * from an earlier visit, or an unknown bag, adds the full quantity as before.
 */
export function buyNowQuantity(qty: number, addedHere: boolean, inBag: number | null): number {
  if (!addedHere || inBag === null) return qty
  return Math.max(0, qty - inBag)
}

/**
 * "Free delivery on orders over 3,400.00৳" when Bundles gives free delivery
 * (the same rule checkout applies: on, with a minimum above 0); null hides it.
 */
export function freeDeliveryLine(template: string, config: BundleConfig | null): string | null {
  if (!template || !config?.settings?.is_active) return null
  const threshold = Number(config.settings.free_shipping_threshold)
  if (!Number.isFinite(threshold) || threshold <= 0) return null
  return template.replace("{amount}", formatPrice(threshold))
}

/**
 * The case types to offer when the selected one is sold out: made for this
 * model, in stock, in the page's order, at most `limit`.
 */
export function soldOutAlternatives({ caseTypes, current, fits, available, limit = 3 }: {
  caseTypes: string[]
  current: string
  fits: (caseType: string) => boolean
  available: (caseType: string) => number
  limit?: number
}): string[] {
  return caseTypes.filter((ct) => ct !== current && fits(ct) && available(ct) > 0).slice(0, limit)
}
