import CartLineItem from "@/components/cart-line-item"
import { ButtonLink } from "@/components/ui/button"
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
      <div className="mx-auto max-w-md space-y-5 py-16 text-center">
        <p className="eyebrow">Cart</p>
        <h1 className="display text-[2.5rem] leading-tight">Nothing here yet</h1>
        <p className="text-ink-muted">
          Pick a design, then choose the device it is cut for.
        </p>
        <ButtonLink href="/" size="lg">
          Browse designs
        </ButtonLink>
      </div>
    )
  }

  const subtotal = cart?.subtotal ?? 0
  const threshold = districts?.shipping.free_threshold ?? 0
  const remainingForFree = Math.max(0, threshold - subtotal)

  return (
    <div className="space-y-10">
      <header className="space-y-2 border-b border-line pb-6">
        <p className="eyebrow">Cart</p>
        <h1 className="display text-[2.25rem] leading-tight md:text-[3rem]">
          Your bag
        </h1>
      </header>

      <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
        <ul className="divide-y divide-line border-b border-line">
          {items.map((item) => (
            <CartLineItem
              key={item.id}
              item={item}
              currencyCode={currencyCode}
            />
          ))}
        </ul>

        <aside className="h-fit space-y-5 border border-line bg-surface p-6">
          <h2 className="eyebrow">Summary</h2>

          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">Subtotal</span>
            <span className="display text-2xl tabular-nums">
              {formatPrice(subtotal, currencyCode)}
            </span>
          </div>

          {districts ? (
            remainingForFree > 0 ? (
              <p className="border-t border-line pt-4 text-sm text-ink-muted">
                Add{" "}
                <span className="text-ink">
                  {formatPrice(remainingForFree, currencyCode)}
                </span>{" "}
                more for free delivery. Otherwise it is{" "}
                {formatPrice(districts.shipping.inside_dhaka, currencyCode)}{" "}
                inside Dhaka,{" "}
                {formatPrice(districts.shipping.outside_dhaka, currencyCode)}{" "}
                outside.
              </p>
            ) : (
              <p className="border-t border-line pt-4 text-sm text-success">
                This order qualifies for free delivery.
              </p>
            )
          ) : null}

          <ButtonLink href="/checkout/" size="lg" fullWidth>
            Proceed to checkout
          </ButtonLink>

          <p className="eyebrow text-center">Cash on Delivery</p>

          <ButtonLink href="/" variant="ghost" size="sm" fullWidth>
            Continue shopping
          </ButtonLink>
        </aside>
      </div>
    </div>
  )
}
