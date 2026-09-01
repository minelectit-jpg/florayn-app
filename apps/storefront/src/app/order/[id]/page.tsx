import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import ProductImage from "@/components/product-image"
import { getOrderSummary } from "@/lib/checkout"
import { formatPrice } from "@/lib/money"

type Params = { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const order = await getOrderSummary(id)
  return {
    title: order ? `Order #${order.display_id}` : "Order",
    // Confirmation pages should never be indexed or followed.
    robots: { index: false, follow: false },
  }
}

export default async function OrderPage({ params }: Params) {
  const { id } = await params
  const order = await getOrderSummary(id)

  if (!order) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-3 border-b border-[var(--color-line)] pb-6">
        <p className="text-sm text-green-800">Order placed</p>
        <h1 className="display text-4xl">Thank you</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Your order number is{" "}
          <strong className="text-[var(--color-ink)]">
            #{order.display_id}
          </strong>
          . Please keep it for reference - we will call{" "}
          {order.delivery.phone} to confirm delivery.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="display text-xl">Items</h2>
        <ul className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 py-4">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden border border-[var(--color-line)] bg-white">
                <ProductImage
                  src={item.thumbnail}
                  alt=""
                  label={item.title}
                  sizes="64px"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  {item.variant_title}
                  {item.sku ? ` - ${item.sku}` : ""}
                </p>
              </div>
              <span className="text-sm text-[var(--color-ink-soft)]">
                &times; {item.quantity}
              </span>
              <span className="w-24 text-right text-sm tabular-nums">
                {formatPrice(
                  item.unit_price * item.quantity,
                  order.currency_code
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section className="space-y-2">
          <h2 className="display text-xl">Delivering to</h2>
          <address className="text-sm not-italic leading-relaxed text-[var(--color-ink-soft)]">
            <span className="text-[var(--color-ink)]">
              {order.delivery.name}
            </span>
            <br />
            {order.delivery.address}
            <br />
            {order.delivery.area}, {order.delivery.district}
            <br />
            {order.delivery.phone}
          </address>
          {order.shipping_method ? (
            <p className="text-xs text-[var(--color-ink-soft)]">
              {order.shipping_method}
            </p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="display text-xl">Total</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-soft)]">Subtotal</dt>
              <dd>{formatPrice(order.subtotal, order.currency_code)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-soft)]">Delivery</dt>
              <dd>
                {order.shipping_total === 0
                  ? "Free"
                  : formatPrice(order.shipping_total, order.currency_code)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-[var(--color-line)] pt-2">
              <dt className="font-medium">To pay on delivery</dt>
              <dd className="display text-xl">
                {formatPrice(order.total, order.currency_code)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--color-ink-soft)]">
            Payment method: {order.payment_method}. Please keep the exact amount
            ready for the courier.
          </p>
        </section>
      </div>

      <Link href="/" className="inline-block text-sm underline underline-offset-4">
        Continue shopping
      </Link>
    </div>
  )
}
