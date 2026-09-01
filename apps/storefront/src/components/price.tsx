import { splitPrice } from "@/lib/money"

/**
 * A price with its currency symbol in a separate span, so the symbol can carry
 * the lighter weight and opacity the shop card uses.
 */
export default function Price({
  amount,
  currencyCode = "bdt",
  className = "",
}: {
  amount: number | null | undefined
  currencyCode?: string
  className?: string
}) {
  const { value, symbol, suffix } = splitPrice(amount, currencyCode)

  if (!symbol) {
    return <span className={className}>{value}</span>
  }

  return (
    <span className={className}>
      {suffix ? null : <span className="fl-price__symbol">{symbol} </span>}
      {value}
      {suffix ? <span className="fl-price__symbol">{symbol}</span> : null}
    </span>
  )
}
