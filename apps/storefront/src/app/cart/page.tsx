import Link from "next/link"

import { getCart, updateLineItem } from "@/lib/cart"
import { formatPrice } from "@/lib/money"

export const metadata = { title: "Cart" }
export const dynamic = "force-dynamic"

export default async function CartPage() {
  const cart = await getCart()
  const items = cart?.items ?? []

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
          <li key={item.id} className="flex flex-wrap items-center gap-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {item.variant?.product?.title ?? item.title}
              </p>
              <p className="text-xs text-[var(--color-ink-soft)]">
                {item.variant?.title}
                {item.variant?.sku ? ` - ${item.variant.sku}` : ""}
              </p>
            </div>

            <form
              action={async (formData: FormData) => {
                "use server"
                await updateLineItem(
                  item.id,
                  Number(formData.get("quantity") ?? 0)
                )
              }}
              className="flex items-center gap-2"
            >
              <input
                type="number"
                name="quantity"
                min={0}
                defaultValue={item.quantity}
                className="w-16 border border-[var(--color-line)] bg-white px-2 py-1 text-sm"
              />
              <button
                type="submit"
                className="text-xs underline underline-offset-4"
              >
                Update
              </button>
            </form>

            <p className="w-24 text-right text-sm">
              {formatPrice(
                item.unit_price * item.quantity,
                cart?.currency_code
              )}
            </p>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-[var(--color-ink-soft)]">Subtotal</span>
        <span className="display text-2xl">
          {formatPrice(cart?.subtotal, cart?.currency_code)}
        </span>
      </div>

      <p className="text-xs text-[var(--color-ink-soft)]">
        Checkout is not built yet. Shipping and payment are configured in the
        backend (Inside Dhaka / Outside Dhaka, manual payment).
      </p>
    </div>
  )
}
