/**
 * Medusa v2 stores prices as decimal amounts, not minor units, so a BDT price
 * of 1690 is 1690 taka. Taka is quoted in whole units in Bangladesh, so poisha
 * are only shown when an amount actually has them.
 */
export function formatPrice(
  amount: number | null | undefined,
  currencyCode = "bdt"
): string {
  if (amount == null || Number.isNaN(amount)) {
    return "-"
  }

  const hasFraction = Math.abs(amount % 1) > 0.0001
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })

  if (currencyCode.toLowerCase() === "bdt") {
    return `৳${formatted}`
  }

  return `${currencyCode.toUpperCase()} ${formatted}`
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
