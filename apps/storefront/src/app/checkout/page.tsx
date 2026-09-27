import Link from "next/link"
import { redirect } from "next/navigation"
import { Check, LockKeyhole } from "lucide-react"

import CheckoutForm from "@/components/checkout-form"
import { cartPromoCodes, getCart } from "@/lib/cart"
import { getCheckoutSettings, getDistricts } from "@/lib/checkout"
import { checkoutLines } from "@/lib/checkout-form-data"
import { icEventId } from "@/lib/tracking/server/checkout-context"
import { checkoutConsent, getTrackingConfig } from "@/lib/tracking/server/config"
import "./checkout.css"

export const metadata = { title: "Checkout", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function CheckoutPage() {
  // Tracking (TRACKING.md 5.4) gets InitiateCheckout's id, derived from the
  // cart id (a capability that never reaches the browser), and the consent
  // line, which exists only while contact hashes are shared.
  const [cart, districts, settings, promoCodes, tracking] = await Promise.all([getCart(), getDistricts(), getCheckoutSettings(),
    cartPromoCodes(), getTrackingConfig()])
  const items = cart?.items ?? []
  if (!items.length) redirect("/cart/")

  if (!districts) return (
    <div data-checkout className="checkout-unavailable">
      <h1 className="display text-3xl">Let’s get you checked out</h1>
      <p>Delivery options could not load. Your bag is still saved.</p>
      <a href="/checkout/" className="checkout-retry">Try again</a>
      <Link href="/cart/" className="underline underline-offset-4">Return to bag</Link>
    </div>
  )

  return (
    <div data-checkout className="checkout-page">
      <div className="checkout-intro">
        <nav aria-label="Checkout progress"><Link href="/cart/"><Check size={13} aria-hidden="true" /> Bag</Link><span aria-hidden="true">/</span><span aria-current="step">Checkout</span><span aria-hidden="true">/</span><span>Confirmation</span></nav>
        <h1>{settings.heading}</h1>
        <p>{settings.description}</p>
        <span className="checkout-guest"><LockKeyhole size={14} aria-hidden="true" /> Guest checkout · No account needed</span>
      </div>
      <CheckoutForm districts={districts} items={checkoutLines(items)} subtotal={cart?.subtotal ?? 0}
        bundleDiscount={cart?.bundleDiscount ?? 0} currencyCode={cart?.currency_code ?? "bdt"} settings={settings} promoCodes={promoCodes}
        trackingEventId={cart ? icEventId(cart.id) : null} consent={checkoutConsent(tracking)} />
    </div>
  )
}
