import Link from "@/components/audience-link"
import { ArrowLeft, ArrowRight, Check, LockKeyhole, ShoppingBag, Tag, Truck, Wallet } from "lucide-react"

import CartLineItem from "@/components/cart-line-item"
import { ButtonLink } from "@/components/ui/button"
import { getCart } from "@/lib/cart"
import { getDistricts } from "@/lib/checkout"
import { formatPrice } from "@/lib/money"

export const metadata = { title: "Your bag", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function CartPage() {
  const [cart, districts] = await Promise.all([getCart(), getDistricts()])
  const items = cart?.items ?? []
  const currencyCode = cart?.currency_code ?? "bdt"
  const count = items.reduce((sum, item) => sum + item.quantity, 0)

  if (!items.length) {
    return <div className="fl-bag-empty">
      <div className="fl-bag-empty__icon"><ShoppingBag size={38} strokeWidth={1.4} /></div>
      <p className="eyebrow text-purple-deep">A little room for something you love</p>
      <h1>Your bag is waiting.</h1>
      <p>Find your favourite design and make it yours.</p>
      <ButtonLink href="/" size="lg" className="rounded-full">Explore the collection <ArrowRight size={17} /></ButtonLink>
      <Link href="/account/" className="fl-text-link">Visit your account</Link>
    </div>
  }

  // getCart normalizes this to goods only, even after a checkout shipping method exists.
  const subtotal = cart?.subtotal ?? 0
  const discount = cart?.bundleDiscount ?? 0
  const total = Math.max(0, subtotal - discount)

  return (
    <div className="fl-bag">
      <nav className="fl-bag__steps" aria-label="Checkout progress">
        <span aria-current="step"><ShoppingBag size={15} /> Your bag</span><ArrowRight size={13} aria-hidden="true" /><span>Checkout</span><ArrowRight size={13} aria-hidden="true" /><span>Your order</span>
      </nav>
      <header className="fl-bag__heading">
        <div><p className="eyebrow text-purple-deep">Your selection</p><h1>Your bag <span>{count}</span></h1><p>A few good choices. Ready when you are.</p></div>
        <Link href="/" className="fl-text-link"><ArrowLeft size={16} /> Continue shopping</Link>
      </header>

      <div className="fl-bag__layout">
        <section aria-label="Items in your bag" className="min-w-0">
          <div className="fl-bag__items-heading"><h2>{count} {count === 1 ? "item" : "items"} in your bag</h2><span>Made to match your everyday.</span></div>
          <ul className="fl-bag__items">
            {items.map((item) => <CartLineItem key={item.id} item={item} currencyCode={currencyCode} />)}
          </ul>
          <div className="fl-bag__help"><div className="fl-surface-icon"><Wallet size={20} /></div><div><strong>Pay when it arrives</strong><p>Cash on delivery. No account needed to check out.</p></div><Check size={18} className="text-purple shrink-0" /></div>
        </section>

        <aside className="fl-bag__summary" aria-label="Order summary">
          <p className="eyebrow">Almost yours</p>
          <h2>Order summary</h2>
          <dl className="fl-bag__totals">
            <div><dt>Items subtotal</dt><dd>{formatPrice(subtotal, currencyCode)}</dd></div>
            {discount > 0 ? <div className="text-purple-deep"><dt>Bundle savings</dt><dd>−{formatPrice(discount, currencyCode)}</dd></div> : null}
            <div><dt>Delivery</dt><dd className="text-ink-muted text-xs">Calculated at checkout</dd></div>
            <div className="fl-bag__total"><dt>Subtotal<small>Before delivery</small></dt><dd>{formatPrice(total, currencyCode)}</dd></div>
          </dl>
          {discount > 0 ? <p className="fl-bag__savings"><Tag size={18} /> You save {formatPrice(discount, currencyCode)}</p> : null}
          <ButtonLink href="/checkout/" size="lg" fullWidth className="rounded-full min-h-[54px]">Proceed to checkout <ArrowRight size={18} /></ButtonLink>
          <p className="fl-bag__secure"><LockKeyhole size={13} /> Cash on delivery · No advance payment</p>
          {districts ? <div className="fl-bag__delivery"><Truck size={20} /><p><strong>Delivery across Bangladesh</strong><span>{formatPrice(districts.shipping.inside_dhaka, currencyCode)} inside Dhaka · {formatPrice(districts.shipping.outside_dhaka, currencyCode)} outside Dhaka</span><small>Final delivery charge and any eligible offer appear at checkout.</small></p></div> : null}
          <Link href="/contact/" className="fl-bag__contact">Need a hand? <span>Contact us <ArrowRight size={14} /></span></Link>
        </aside>
      </div>
    </div>
  )
}
