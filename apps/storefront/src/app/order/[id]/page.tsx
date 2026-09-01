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
      <header className="space-y-3 border-b border-line pb-8">
        <p className="eyebrow text-success">Order placed</p>
        <h1 className="display text-[2.5rem] leading-tight md:text-[3.25rem]">Thank you</h1>
        <p className="text-ink-muted">
          Your order number is{" "}
          <strong className="text-purple">
            #{order.display_id}
          </strong>
          . Please keep it for reference - we will call{" "}
          {order.delivery.phone} to confirm delivery.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="eyebrow">Items</h2>
        <ul className="divide-y divide-line border-y border-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 py-4">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden border border-line bg-paper">
                <ProductImage
                  src={item.thumbnail}
                  alt=""
                  label={item.title}
                  sizes="64px"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="display text-base">{item.title}</p>
                <p className="eyebrow pt-1">
                  {item.variant_title}
                  {item.sku ? ` - ${item.sku}` : ""}
                </p>
              </div>
              <span className="text-sm text-ink-faint">
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
          <h2 className="eyebrow">Delivering to</h2>
          <address className="text-sm not-italic leading-relaxed text-ink-muted">
            <span className="text-ink">
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
            <p className="eyebrow pt-2">
              {order.shipping_method}
            </p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="eyebrow">Total</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd>{formatPrice(order.subtotal, order.currency_code)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Delivery</dt>
              <dd>
                {formatPrice(order.shipping_total, order.currency_code)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3">
              <dt className="font-medium">To pay on delivery</dt>
              <dd className="display text-2xl tabular-nums">
                {formatPrice(order.total, order.currency_code)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-ink-muted">
            Payment method: {order.payment_method}. Please keep the exact amount
            ready for the courier.
          </p>
        </section>
      </div>

      <Link href="/" className="inline-block text-sm text-ink-muted underline underline-offset-4 transition-colors hover:text-purple">
        Continue shopping
      </Link>
    </div>
  )
}
