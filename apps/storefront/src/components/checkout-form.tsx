"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Check, ChevronDown, LockKeyhole, Phone, ShoppingBag, Truck } from "lucide-react"

import { useCart } from "@/components/cart-provider"
import ProductImage from "@/components/product-image"
import PromoCode from "@/components/promo-code"
import { Button, Spinner } from "@/components/ui/button"
import { quoteCheckout, submitOrder } from "@/lib/cart"
import type { CheckoutQuote, CheckoutSettings, DistrictsResponse } from "@/lib/checkout"
import { EMPTY_CHECKOUT_FIELDS, normalizeCheckoutPhone, validateCheckout, type CheckoutFields, type CheckoutLine } from "@/lib/checkout-form-data"
import { formatPrice } from "@/lib/money"

export default function CheckoutForm({ districts, items: initialItems, subtotal, bundleDiscount = 0, currencyCode, settings, promoCodes = [] }: {
  districts: DistrictsResponse
  /** Discount codes already on the bag (a review reward, say). */
  promoCodes?: string[]
  items: CheckoutLine[]
  subtotal: number
  bundleDiscount?: number
  currencyCode: string
  settings: CheckoutSettings
}) {
  const router = useRouter()
  const { applySummary } = useCart()
  const [fields, setFields] = useState<CheckoutFields>(EMPTY_CHECKOUT_FIELDS)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const updateNoticeRef = useRef<HTMLDivElement>(null)
  const [quote, setQuote] = useState<CheckoutQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [quoteError, setQuoteError] = useState("")
  const quoteSequence = useRef(0)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true)
    window.addEventListener("florayn:checkout-update", onUpdate)
    return () => window.removeEventListener("florayn:checkout-update", onUpdate)
  }, [])

  // A district change invalidates the old price immediately. Late responses can
  // never enable ordering with a quote for a previous district.
  useEffect(() => {
    const sequence = ++quoteSequence.current
    setQuote(null)
    setQuoteError("")
    if (!fields.district) { setQuoting(false); return }
    setQuoting(true)
    quoteCheckout(fields.district).then((result) => {
      if (quoteSequence.current !== sequence) return
      if (result.ok) setQuote(result.quote)
      else setQuoteError(Object.values(result.errors).join(" "))
    }).catch(() => {
      if (quoteSequence.current === sequence) setQuoteError("Could not confirm delivery and total. Please try again.")
    }).finally(() => {
      if (quoteSequence.current === sequence) setQuoting(false)
    })
    return () => { quoteSequence.current++ }
  }, [fields.district, quoteAttempt])

  const currentQuote = quote?.district === fields.district ? quote : null
  const items = currentQuote?.items?.length ? currentQuote.items : initialItems
  const count = items.reduce((sum, item) => sum + item.quantity, 0)
  const goodsSubtotal = currentQuote?.subtotal ?? subtotal
  const discount = currentQuote?.discount_total ?? bundleDiscount
  const currency = currentQuote?.currency_code ?? currencyCode
  const money = (amount: number) => formatPrice(amount, currency)
  const payable = currentQuote ? money(currentQuote.total) : money(Math.max(0, goodsSubtotal - discount))

  function set<K extends keyof CheckoutFields>(key: K, value: CheckoutFields[K]) {
    setFields((previous) => ({ ...previous, [key]: value }))
    if (key === "district") { setQuote(null); setQuoting(Boolean(value)) }
    setErrors((previous) => { const next = { ...previous }; delete next[key]; delete next.form; return next })
  }

  function focusErrors(next: Record<string, string>) {
    const field = Object.keys(next).find((key) => key in EMPTY_CHECKOUT_FIELDS)
    if (field === "note") setNoteOpen(true)
    requestAnimationFrame(() => {
      const target = field ? formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`) : formRef.current?.querySelector<HTMLElement>("[data-checkout-errors]")
      target?.focus()
      target?.scrollIntoView({ block: "center", behavior: "auto" })
    })
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current || updateAvailable) return
    const invalid = validateCheckout(fields, districts.districts)
    if (Object.keys(invalid).length) { setErrors(invalid); focusErrors(invalid); return }
    if (quoting) return
    if (!currentQuote) {
      const next = { form: "Please confirm your delivery charge and total before placing your order." }
      setErrors(next); focusErrors(next); setQuoteAttempt((attempt) => attempt + 1); return
    }
    submittingRef.current = true
    setSubmitting(true)
    setErrors({})
    let navigating = false
    try {
      const result = await submitOrder({
        full_name: fields.full_name.trim(), phone: normalizeCheckoutPhone(fields.phone),
        email: fields.email.trim() || undefined, address: fields.address.trim(),
        district: fields.district, area: fields.area.trim(),
        note: settings.show_order_note ? fields.note.trim() || undefined : undefined,
        quote_version: currentQuote.version,
      })
      if (result.ok) {
        applySummary({ itemCount: 0, subtotal: 0, currencyCode: currency, bundleDiscount: 0 })
        router.push(`/order/${result.order.id}/`)
        navigating = true
        return
      }
      if (result.quote) { setQuote(result.quote); setSummaryOpen(true) }
      setErrors(result.errors)
      focusErrors(result.errors)
    } catch {
      const next = { form: "The connection was interrupted. Your details are still here. Try again to check your order safely." }
      setErrors(next); focusErrors(next)
    } finally {
      if (!navigating) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  function inputProps(id: keyof CheckoutFields, required = false) {
    return {
      id, name: id, "data-field": id, value: fields[id], required,
      disabled: submitting,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(id, event.target.value),
      "aria-invalid": Boolean(errors[id]),
      "aria-describedby": errors[id] ? `${id}-error` : undefined,
      className: "checkout-input",
    }
  }

  const submitLabel = submitting ? "Placing your order…" : "Place order"
  const submitButton = (mobile = false) => (
    <Button type={updateAvailable ? "button" : "submit"} variant="ink" size="lg" fullWidth disabled={submitting || (quoting && !updateAvailable)}
      aria-controls={updateAvailable ? "checkout-update-notice" : undefined}
      onClick={updateAvailable ? () => {
        updateNoticeRef.current?.focus({ preventScroll: true })
        updateNoticeRef.current?.scrollIntoView({ block: "center", behavior: "auto" })
      } : undefined}
      className={`checkout-place-order ${mobile ? "" : "checkout-desktop-submit"}`}>
      {submitting || (quoting && !updateAvailable) ? <Spinner /> : null}
      {updateAvailable && !submitting ? "View update" : quoting ? "Confirming total…" : submitLabel}
      {!submitting && !quoting ? <ArrowRight size={17} aria-hidden="true" /> : null}
    </Button>
  )

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="checkout-form" aria-busy={submitting}>
      <section className="checkout-delivery" aria-labelledby="delivery-title">
        <div className="checkout-section-title">
          <span className="checkout-step" aria-hidden="true">1</span>
          <div><h2 id="delivery-title">Where should we deliver?</h2><p>No account needed. All orders ship within Bangladesh.</p></div>
        </div>
        <div className="checkout-fields">
          <div className="checkout-field-pair">
            <Field id="full_name" label="Full name" error={errors.full_name} required>
              <input {...inputProps("full_name", true)} autoComplete="name" placeholder="Your full name" maxLength={100} />
            </Field>
            <Field id="phone" label="Mobile number" error={errors.phone} required>
              <input {...inputProps("phone", true)} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" maxLength={24} />
            </Field>
          </div>
          <div className="checkout-field-pair">
            <Field id="district" label="City / district" error={errors.district} required>
              <select {...inputProps("district", true)} autoComplete="address-level1">
                <option value="">Select your district</option>
                {districts.districts.map((district) => <option key={district} value={district}>{district}</option>)}
              </select>
            </Field>
            <Field id="area" label="Area / thana" error={errors.area} required>
              <input {...inputProps("area", true)} autoComplete="address-level2" placeholder="e.g. Dhanmondi" maxLength={100} />
            </Field>
          </div>
          <Field id="address" label="Full delivery address" error={errors.address} required>
            <textarea {...inputProps("address", true)} rows={2} autoComplete="street-address" placeholder="House, road, block or village" maxLength={500} />
          </Field>
          <Field id="email" label="Email address" error={errors.email}>
            <input {...inputProps("email")} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" maxLength={254} />
          </Field>
          {settings.show_order_note ? <div>
            <button className="checkout-note-toggle" type="button" disabled={submitting} aria-expanded={noteOpen} aria-controls="checkout-note" onClick={() => setNoteOpen(!noteOpen)}>
              <span>{noteOpen ? "−" : "+"}</span> Add a delivery note <span className="text-ink-muted">(optional)</span>
            </button>
            <div id="checkout-note" hidden={!noteOpen} className="mt-3">
              <Field id="note" label="Delivery note" error={errors.note}>
                <textarea {...inputProps("note")} rows={2} placeholder="Anything that helps the courier find you" maxLength={500} />
              </Field>
            </div>
          </div> : null}
        </div>
        <div className="checkout-delivery-note"><Truck size={18} aria-hidden="true" /><p>{settings.delivery_note || "Choose your district to see the delivery charge before you order."}</p></div>
        <Link href="/cart/" className="checkout-back"><ArrowLeft size={16} aria-hidden="true" /> Return to bag</Link>
      </section>

      <aside className="checkout-aside" aria-label="Review your order and payment">
        <section className="checkout-summary" aria-labelledby="order-title">
          <div className="checkout-summary-heading">
            <div><p className="checkout-kicker">REVIEW YOUR SELECTION</p><h2 id="order-title">Your order <span>{count} {count === 1 ? "item" : "items"}</span></h2></div>
            <Link href="/cart/" className="checkout-edit">Edit bag</Link>
          </div>
          <button type="button" className="checkout-summary-toggle" aria-expanded={summaryOpen} aria-controls="checkout-summary-detail" onClick={() => setSummaryOpen(!summaryOpen)}>
            <span><ShoppingBag size={16} aria-hidden="true" /> {summaryOpen ? "Hide order details" : "Show order details"} <ChevronDown size={15} className={summaryOpen ? "rotate-180" : ""} aria-hidden="true" /></span>
            <strong>{payable}{!currentQuote ? <small> + delivery</small> : null}</strong>
          </button>
          <div id="checkout-summary-detail" className={summaryOpen ? "checkout-summary-detail" : "checkout-summary-detail checkout-summary-collapsed"}>
            <ul className="checkout-items">
              {items.map((item, index) => <li key={item.id}>
                <div className="checkout-item-image"><ProductImage src={item.thumbnail} alt={item.title} label={item.title} sizes="72px" priority={index < 2} fillMode="absolute" className="absolute inset-0 h-full w-full object-contain" /><span>{item.quantity}</span></div>
                <div className="checkout-item-copy"><h3>{item.title}</h3><p>{item.variant_title}</p><span>Qty {item.quantity}</span></div>
                <strong className="checkout-line-price">{money(item.subtotal)}</strong>
              </li>)}
            </ul>
            <dl className="checkout-totals">
              <div><dt>Subtotal</dt><dd>{money(goodsSubtotal)}</dd></div>
              {discount > 0 ? <div className="checkout-saving"><dt><Check size={14} aria-hidden="true" /> {currentQuote ? "Savings applied" : "Estimated bundle savings"}</dt><dd>−{money(discount)}</dd></div> : null}
              <div><dt>Delivery{currentQuote ? <small> to {currentQuote.district}</small> : null}</dt><dd>{quoting ? "Confirming…" : currentQuote ? currentQuote.shipping_total === 0 ? <span className="text-success">Free</span> : money(currentQuote.shipping_total) : "Select a district"}</dd></div>
              {currentQuote && currentQuote.tax_total > 0 ? <div><dt>Tax</dt><dd>{money(currentQuote.tax_total)}</dd></div> : null}
            </dl>
            <PromoCode initialCodes={promoCodes} disabled={submitting} onChange={() => setQuoteAttempt((attempt) => attempt + 1)} />
            {currentQuote?.free_shipping ? <p className="checkout-free"><Truck size={15} aria-hidden="true" /> Free delivery applied to this order</p> : null}
          </div>
        </section>

        <section className="checkout-payment" aria-labelledby="payment-title">
          <div className="checkout-section-title"><span className="checkout-step" aria-hidden="true">2</span><h2 id="payment-title">Payment</h2></div>
          <div className="checkout-cod"><span className="checkout-radio" aria-hidden="true"><span /></span><div><p>Cash on Delivery</p><span>Pay the courier when your parcel arrives.<br />No advance payment needed.</span></div><LockKeyhole size={18} aria-hidden="true" /></div>
          {updateAvailable ? <div ref={updateNoticeRef} id="checkout-update-notice" tabIndex={-1} role="status" className="checkout-error-box mt-4">
            <p>{submitting ? "A checkout update is available. Please wait while we confirm your order." : "Checkout has been updated. Reload before ordering. Reloading will clear these delivery details; your bag stays saved."}</p>
            {!submitting ? <button type="button" className="mt-2" onClick={() => window.location.reload()}>Reload checkout</button> : null}
          </div> : null}
          <div className="checkout-grand-total" aria-live="polite" aria-atomic="true"><div><span>{currentQuote ? "Total to pay" : "Subtotal after savings"}</span><small>{currentQuote ? "Pay in cash on delivery" : "Delivery confirmed after district selection"}</small></div><strong>{payable}</strong></div>
          {quoteError ? <div role="alert" className="checkout-error-box"><p>{quoteError}</p><button type="button" disabled={quoting || submitting} onClick={() => setQuoteAttempt((attempt) => attempt + 1)}>Retry delivery calculation</button></div> : null}
          {Object.keys(errors).length ? <div role="alert" tabIndex={-1} data-checkout-errors className="checkout-error-box"><p className="font-semibold">Please check before placing your order</p><ul>{Object.entries(errors).map(([key, message]) => <li key={key}>{key in EMPTY_CHECKOUT_FIELDS ? <button type="button" onClick={() => focusErrors({ [key]: message })}>{message}</button> : message}</li>)}</ul>{errors.cart_id ? <Link href="/cart/">Return to your bag</Link> : null}</div> : null}
          {submitButton()}
          <p className="checkout-terms">Please check your device model and delivery address before placing your order.</p>
          {settings.support_phone ? <a href={`tel:${settings.support_phone}`} className="checkout-help"><Phone size={15} aria-hidden="true" /><span>{settings.support_label} <strong>{settings.support_phone}</strong></span></a> : null}
        </section>
      </aside>
      <div className="checkout-mobile-bar"><div><span>{currentQuote ? "Total to pay" : "Subtotal + delivery"}</span><strong>{payable}{!currentQuote ? <small> + delivery</small> : null}</strong></div>{submitButton(true)}</div>
      <p role="status" aria-live="polite" className="sr-only">{submitting ? "Placing your order. Please wait." : quoting ? "Confirming your delivery charge and total." : ""}</p>
    </form>
  )
}

function Field({ id, label, error, required, children }: { id: string; label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return <div className="checkout-field"><label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : <small> (optional)</small>}</label>{children}{error ? <p id={`${id}-error`} className="checkout-field-error">{error}</p> : null}</div>
}
