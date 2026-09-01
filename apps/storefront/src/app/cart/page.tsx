import Link from "next/link"

import CartLineItem from "@/components/cart-line-item"
import { getCart } from "@/lib/cart"
import { formatPrice } from "@/lib/money"

export const metadata = { title: "Cart" }
export const dynamic = "force-dynamic"

export default async function CartPage() {
  const cart = await getCart()
  const items = cart?.items ?? []
  const currencyCode = cart?.currency_code ?? "bdt"

  if (!items.length) {
    return (
      <div className="space-y-4">
        <h1 className="display text-4xl">Cart</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Your cart is empty.
        </p>
        <Link href="/" className="text-sm underline underline-offset-4">
          Browse designs
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="display text-4xl">Cart</h1>

      <ul className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        {items.map((item) => (
          <CartLineItem
            key={item.id}
            item={item}
            currencyCode={currencyCode}
          />
        ))}
      </ul>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-[var(--color-ink-soft)]">Subtotal</span>
        <span className="display text-2xl">
          {formatPrice(cart?.subtotal, currencyCode)}
        </span>
      </div>

      <p className="text-xs text-[var(--color-ink-soft)]">
        Checkout is not built yet. Shipping and payment are configured in the
        backend (Inside Dhaka / Outside Dhaka, manual payment).
      </p>
    </div>
  )
}
