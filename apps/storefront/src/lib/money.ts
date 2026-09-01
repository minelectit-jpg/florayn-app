/**
 * Prices render as "1,400৳" - figure first, symbol after, no decimals.
 *
 * The symbol follows the number because that is what florayn.com does; the
 * WooCommerce Store API reports an empty currency prefix and a "৳" suffix for
 * BDT. Decimals are dropped because every price in this catalogue is a whole
 * number of taka.
 */
export function formatPrice(
  amount: number | null | undefined,
  currencyCode = "bdt"
): string {
  if (amount == null || Number.isNaN(amount)) {
    return "-"
  }

  const value = amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

  if (currencyCode.toLowerCase() === "bdt") {
    return `${value}৳`
  }

  return `${value} ${currencyCode.toUpperCase()}`
}

/** Lowest price across a product's variants, for "from ৳1,290" on cards. */
export function priceRange(
  variants: { calculated_price?: { calculated_amount: number } | null }[] = []
): { min: number; max: number } | null {
  const amounts = variants
    .map((v) => v.calculated_price?.calculated_amount)
    .filter((a): a is number => typeof a === "number")

  if (!amounts.length) {
    return null
  }

  return { min: Math.min(...amounts), max: Math.max(...amounts) }
}

/**
 * Splits a price into figure and symbol so the shop card can style the symbol
 * separately - the live site renders it at weight 500 and .75 opacity.
 */
export function splitPrice(
  amount: number | null | undefined,
  currencyCode = "bdt"
): { value: string; symbol: string; suffix: boolean } {
  if (amount == null || Number.isNaN(amount)) {
    return { value: "-", symbol: "", suffix: true }
  }

  const value = amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

  if (currencyCode.toLowerCase() === "bdt") {
    return { value, symbol: "৳", suffix: true }
  }

  return { value, symbol: currencyCode.toUpperCase(), suffix: false }
}
