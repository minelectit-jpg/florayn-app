import Link from "next/link"

import CartLineItem from "@/components/cart-line-item"
import { getCart } from "@/lib/cart"
import { getDistricts } from "@/lib/checkout"
import { formatPrice } from "@/lib/money"

export const metadata = { title: "Cart" }
export const dynamic = "force-dynamic"

export default async function CartPage() {
  const [cart, districts] = await Promise.all([getCart(), getDistricts()])
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

  const subtotal = cart?.subtotal ?? 0
  const threshold = districts?.shipping.free_threshold ?? 0
  const remainingForFree = Math.max(0, threshold - subtotal)

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
          {formatPrice(subtotal, currencyCode)}
        </span>
      </div>

      {districts ? (
        remainingForFree > 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Add {formatPrice(remainingForFree, currencyCode)} more for free
            delivery. Otherwise delivery is{" "}
            {formatPrice(districts.shipping.inside_dhaka, currencyCode)} inside
            Dhaka and{" "}
            {formatPrice(districts.shipping.outside_dhaka, currencyCode)}{" "}
            outside.
          </p>
        ) : (
          <p className="text-sm text-green-800">
            This order qualifies for free delivery.
          </p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/checkout/"
          className="bg-[var(--color-ink)] px-6 py-3 text-sm text-white"
        >
          Proceed to checkout
        </Link>
        <Link href="/" className="text-sm underline underline-offset-4">
          Continue shopping
        </Link>
        <span className="text-xs text-[var(--color-ink-soft)]">
          Cash on Delivery
        </span>
      </div>
    </div>
  )
}
