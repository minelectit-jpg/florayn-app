import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { cache } from "react"
import { ArrowRight, Check, CheckCheck, MapPin, Package, Phone, ShoppingBag, Truck, Wallet, X } from "lucide-react"

import OrderReference from "@/components/order-reference"
import ProductImage from "@/components/product-image"
import { getCheckoutSettings, getOrderSummary } from "@/lib/checkout"
import { formatPrice } from "@/lib/money"
import "./order.css"

type Params = { params: Promise<{ id: string }> }
const readOrder = cache(getOrderSummary)
export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const order = await readOrder((await params).id)
  return { title: order?.display_id != null ? `Order #${order.display_id}` : "Your order",
    robots: { index: false, follow: false }, referrer: "no-referrer" }
}

export default async function OrderPage({ params }: Params) {
  const [order, settings] = await Promise.all([readOrder((await params).id), getCheckoutSettings()])
  if (!order) notFound()
  const cancelled = order.status === "canceled"
  const refunded = order.payment_status === "refunded"
  const paid = order.payment_status === "captured" || order.payment_status === "partially_refunded"
  const partlyPaid = order.payment_status === "partially_captured"
  const closed = order.status === "completed" || order.status === "archived"
  const nextSteps = !cancelled && !refunded && !closed
  const payOnDelivery = order.payment_method.toLowerCase() === "cash on delivery" && !cancelled && !paid && !refunded && !partlyPaid && !closed
  const reference = order.display_id != null ? `#${order.display_id}` : order.id
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const money = (amount: number) => formatPrice(amount, order.currency_code)
  const date = new Date(order.created_at)
  const placedDate = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dhaka",
  }).format(date) : null
  const paymentTitle = refunded ? "Payment refunded" : paid ? "Payment received" : partlyPaid ? "Payment partially received"
    : cancelled ? "Payment method" : payOnDelivery ? "Pay when it arrives" : "Payment details"

  return <div data-order-confirmation className="order-page">
    <nav className="order-breadcrumb" aria-label="Order progress"><span><Check size={13} aria-hidden="true" /> Bag</span><span aria-hidden="true">/</span><span><Check size={13} aria-hidden="true" /> Checkout</span><span aria-hidden="true">/</span><span aria-current="page">Your order</span></nav>
    <header className={`order-hero${cancelled ? " order-hero-cancelled" : ""}`}>
      <div className="order-success-icon" aria-hidden="true">{cancelled ? <X size={28} /> : <Check size={30} strokeWidth={1.8} />}</div>
      <div className="order-hero-copy"><p className="order-eyebrow">{cancelled ? "ORDER UPDATE" : "ORDER RECEIVED"}</p>
        <h1>{cancelled ? "This order was cancelled." : <>Thank you.<br className="order-mobile-break" /> It’s a great choice.</>}</h1>
        <p>{cancelled ? "The order details below are kept for your reference." : "Your order is placed. Thanks for making Florayn part of your everyday."}</p>
      </div>
      <div className="order-reference-card"><span>YOUR ORDER NUMBER</span><OrderReference reference={reference} />{placedDate ? <time dateTime={order.created_at}>Placed on {placedDate}</time> : null}</div>
    </header>
    <div className="order-layout">
      <div className="order-details">
        <section className="order-next" aria-labelledby="order-next-heading">
          <div className="order-section-heading"><h2 id="order-next-heading">{nextSteps ? "What happens next" : "Your order details"}</h2>{nextSteps ? <span className="order-received"><CheckCheck size={13} aria-hidden="true" /> Order placed</span> : null}</div>
          {!nextSteps ? <p className="order-muted">Contact us with your order number if you have a question about this order.</p> : <>
            <ol className="order-next-steps">
              <li><span className="order-step-icon"><Package size={19} aria-hidden="true" /></span><div><h3>Prepared with care</h3><p>Your selected items will be prepared for delivery.</p></div></li>
              <li><span className="order-step-icon"><Truck size={20} aria-hidden="true" /></span><div><h3>Delivered to your door</h3><p>{payOnDelivery ? "Pay the courier when your parcel arrives." : "Your parcel will go to the delivery address below."}</p></div></li>
            </ol>{settings.delivery_note ? <p className="order-delivery-message">{settings.delivery_note}</p> : null}
          </>}
        </section>
        <div className="order-info-grid">
          <section className="order-info-card" aria-labelledby="order-address-heading"><MapPin size={20} className="order-card-icon" aria-hidden="true" /><h2 id="order-address-heading">Delivery address</h2>
            <address><strong>{order.delivery.name}</strong>{order.delivery.address ? <span>{order.delivery.address}</span> : null}{[order.delivery.area, order.delivery.district].filter(Boolean).length ? <span>{[order.delivery.area, order.delivery.district].filter(Boolean).join(", ")}</span> : null}{order.delivery.phone ? <span className="order-masked-phone">{order.delivery.phone}</span> : null}</address>
            {order.shipping_method ? <p className="order-shipping-method"><Truck size={13} aria-hidden="true" />{order.shipping_method}</p> : null}
          </section>
          <section className="order-info-card" aria-labelledby="order-payment-heading"><Wallet size={20} className="order-card-icon" aria-hidden="true" /><h2 id="order-payment-heading">{paymentTitle}</h2><p className="order-payment-method">{order.payment_method}</p><strong className="order-payment-amount">{money(order.total)}</strong>
            <p className="order-muted">{payOnDelivery ? "No advance payment needed. Please keep the exact amount ready for the courier." : refunded ? "Your payment is marked as refunded. Contact us if you need help." : paid ? "Your payment has been recorded. Keep your order number for reference." : partlyPaid ? "This is the order total. Contact us to confirm any remaining payment." : "Keep your order number for any questions about payment."}</p>
          </section>
        </div>
        <section className="order-help" aria-labelledby="order-help-heading"><span className="order-help-icon"><Phone size={18} aria-hidden="true" /></span><div><h2 id="order-help-heading">{settings.support_label || "Need help with your order?"}</h2><p>Have your order number handy when you get in touch.</p></div><Link href="/contact/">Contact us <ArrowRight size={15} aria-hidden="true" /></Link></section>
        {settings.support_phone ? <a className="order-call" href={`tel:${settings.support_phone}`}>Call {settings.support_phone}</a> : null}
        <div className="order-actions"><a href="https://florayn.com/" className="order-shop-button">Continue shopping <ArrowRight size={17} aria-hidden="true" /></a><span>Made to match your everyday.</span></div>
      </div>
      <aside className="order-summary" aria-labelledby="order-summary-heading">
        <div className="order-summary-header"><div><p className="order-eyebrow">YOUR SELECTION</p><h2 id="order-summary-heading">Order summary</h2></div><span><ShoppingBag size={14} aria-hidden="true" />{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>
        <ul className="order-items">{order.items.map((item, index) => <li key={item.id}>
          <div className="order-item-image"><ProductImage src={item.thumbnail} alt={item.title} label={item.title} sizes="80px" priority={index < 2} fillMode="absolute" className="absolute inset-0 h-full w-full object-contain" /><span>{item.quantity}</span></div>
          <div className="order-item-info"><h3>{item.title}</h3>{item.variant_title ? <p>{item.variant_title}</p> : null}<span>Qty {item.quantity}</span></div><div className="order-line-amount"><strong>{money(item.total)}</strong>{item.discount_total > 0 ? <small>Offer applied</small> : null}</div>
        </li>)}</ul>
        <dl className="order-totals"><div><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
          {order.discount_total > 0 ? <div className="order-savings"><dt><Check size={13} aria-hidden="true" /> Savings applied</dt><dd>−{money(order.discount_total)}</dd></div> : null}
          <div><dt>Delivery</dt><dd>{order.shipping_total === 0 ? <span className="order-free">Free</span> : money(order.shipping_total)}</dd></div>
          {order.tax_total > 0 ? <div><dt>Tax</dt><dd>{money(order.tax_total)}</dd></div> : null}
          <div className="order-total"><dt>{payOnDelivery ? "To pay on delivery" : "Order total"}</dt><dd>{money(order.total)}</dd></div>
        </dl><p className="order-summary-note">{cancelled ? "Cancelled order · For your reference" : "Order placed · Keep this page for your reference"}</p>
      </aside>
    </div>
  </div>
}
