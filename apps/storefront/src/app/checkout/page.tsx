import Link from "next/link"
import { redirect } from "next/navigation"

import CheckoutForm from "@/components/checkout-form"
import { getCart } from "@/lib/cart"
import { getDistricts } from "@/lib/checkout"

export const metadata = { title: "Checkout" }
export const dynamic = "force-dynamic"

export default async function CheckoutPage() {
  const [cart, districts] = await Promise.all([getCart(), getDistricts()])
  const items = cart?.items ?? []

  if (!items.length) {
    redirect("/cart/")
  }

  if (!districts) {
    return (
      <div className="space-y-4">
        <h1 className="display text-4xl">Checkout</h1>
        <p className="text-sm text-red-700">
          Could not load delivery districts. The backend may be down - please
          try again in a moment.
        </p>
        <Link href="/cart/" className="text-sm underline underline-offset-4">
          Back to cart
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="display text-4xl">Checkout</h1>
        <Link
          href="/cart/"
          className="text-sm text-[var(--color-ink-soft)] underline underline-offset-4 hover:text-[var(--color-ink)]"
        >
          Back to cart
        </Link>
      </div>

      <ul className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)] text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              {item.variant?.product?.title ?? item.title}
              <span className="text-[var(--color-ink-soft)]">
                {" "}
                - {item.variant?.title}
              </span>
            </span>
            <span className="text-[var(--color-ink-soft)]">
              &times; {item.quantity}
            </span>
          </li>
        ))}
      </ul>

      <CheckoutForm
        districts={districts}
        subtotal={cart?.subtotal ?? 0}
        currencyCode={cart?.currency_code ?? "bdt"}
      />
    </div>
  )
}
