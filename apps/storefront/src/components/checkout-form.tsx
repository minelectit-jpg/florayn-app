"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { useCart } from "@/components/cart-provider"
import { Button, Spinner } from "@/components/ui/button"
import { submitOrder } from "@/lib/cart"
import type { DistrictsResponse } from "@/lib/checkout"
import { formatPrice } from "@/lib/money"

const PHONE_PATTERN = /^01[3-9]\d{8}$/

function normalizePhone(value: string): string {
  let digits = value.replace(/[^\d]/g, "")
  if (digits.startsWith("880")) {
    digits = digits.slice(3)
  }
  if (digits.length === 10 && digits.startsWith("1")) {
    digits = `0${digits}`
  }
  return digits
}

type Fields = {
  full_name: string
  phone: string
  email: string
  address: string
  district: string
  area: string
  note: string
}

const EMPTY: Fields = {
  full_name: "",
  phone: "",
  email: "",
  address: "",
  district: "",
  area: "",
  note: "",
}

export default function CheckoutForm({
  districts,
  subtotal,
  currencyCode,
}: {
  districts: DistrictsResponse
  subtotal: number
  currencyCode: string
}) {
  const router = useRouter()
  const { applySummary } = useCart()
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const insideDhaka = districts.inside_dhaka.includes(fields.district)
  const shipping = insideDhaka
    ? districts.shipping.inside_dhaka
    : districts.shipping.outside_dhaka
  // Until a district is chosen the rate is not known, so show nothing rather
  // than a number that might change once they pick one.
  const shippingKnown = Boolean(fields.district)
  const total = subtotal + (shippingKnown ? shipping : 0)

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((f) => ({ ...f, [key]: value }))
    setErrors((e) => {
      if (!e[key] && !e.form) {
        return e
      }
      const next = { ...e }
      delete next[key]
      delete next.form
      return next
    })
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {}
    if (fields.full_name.trim().length < 2) {
      next.full_name = "Enter the full name for delivery."
    }
    if (!PHONE_PATTERN.test(normalizePhone(fields.phone))) {
      next.phone = "Enter an 11 digit mobile number, like 01712345678."
    }
    if (fields.address.trim().length < 5) {
      next.address = "Enter the full delivery address."
    }
    if (!fields.district) {
      next.district = "Select a district."
    }
    if (!fields.area.trim()) {
      next.area = "Enter the area or thana."
    }
    if (
      fields.email.trim() &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email.trim())
    ) {
      next.email = "That email address does not look right."
    }
    return next
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) {
      return
    }

    const clientErrors = validate()
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors)
      const first = document.querySelector<HTMLElement>(
        `[data-field="${Object.keys(clientErrors)[0]}"]`
      )
      first?.focus()
      first?.scrollIntoView({ block: "center", behavior: "smooth" })
      return
    }

    setSubmitting(true)
    setErrors({})

    const result = await submitOrder({
      full_name: fields.full_name.trim(),
      phone: normalizePhone(fields.phone),
      email: fields.email.trim() || undefined,
      address: fields.address.trim(),
      district: fields.district,
      area: fields.area.trim(),
      note: fields.note.trim() || undefined,
    })

    if (result.ok) {
      applySummary({ itemCount: 0, subtotal: 0, currencyCode })
      router.push(`/order/${result.order.id}/`)
      return
    }

    setErrors(result.errors)
    setSubmitting(false)
    const firstKey = Object.keys(result.errors)[0]
    const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`)
    el?.focus()
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
  }

  const inputClass = "field-input mt-1.5"

  return (
    <form onSubmit={onSubmit} className="grid gap-10 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <section className="space-y-4">
          <h2 className="display text-2xl">Delivery details</h2>

          <Field
            id="full_name"
            label="Full name"
            error={errors.full_name}
            required
          >
            <input
              id="full_name"
              data-field="full_name"
              value={fields.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              autoComplete="name"
              className={inputClass}
              aria-invalid={Boolean(errors.full_name)}
            />
          </Field>

          <Field
            id="phone"
            label="Mobile number"
            hint="11 digits, starting 01"
            error={errors.phone}
            required
          >
            <input
              id="phone"
              data-field="phone"
              value={fields.phone}
              onChange={(e) => set("phone", e.target.value)}
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01712345678"
              maxLength={14}
              className={inputClass}
              aria-invalid={Boolean(errors.phone)}
            />
          </Field>

          <Field
            id="email"
            label="Email"
            hint="Optional - only if you want an emailed receipt"
            error={errors.email}
          >
            <input
              id="email"
              data-field="email"
              type="email"
              value={fields.email}
              onChange={(e) => set("email", e.target.value)}
              autoComplete="email"
              className={inputClass}
              aria-invalid={Boolean(errors.email)}
            />
          </Field>

          <Field
            id="address"
            label="Full address"
            hint="House and road, or village"
            error={errors.address}
            required
          >
            <textarea
              id="address"
              data-field="address"
              value={fields.address}
              onChange={(e) => set("address", e.target.value)}
              rows={3}
              autoComplete="street-address"
              className={inputClass}
              aria-invalid={Boolean(errors.address)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="district"
              label="District"
              error={errors.district}
              required
            >
              <select
                id="district"
                data-field="district"
                value={fields.district}
                onChange={(e) => set("district", e.target.value)}
                className={inputClass}
                aria-invalid={Boolean(errors.district)}
              >
                <option value="">Select a district</option>
                {districts.districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="area"
              label="Area / thana"
              error={errors.area}
              required
            >
              <input
                id="area"
                data-field="area"
                value={fields.area}
                onChange={(e) => set("area", e.target.value)}
                placeholder="Dhanmondi, Mirpur, Sadar..."
                className={inputClass}
                aria-invalid={Boolean(errors.area)}
              />
            </Field>
          </div>

          <Field id="note" label="Delivery note" hint="Optional">
            <textarea
              id="note"
              data-field="note"
              value={fields.note}
              onChange={(e) => set("note", e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>
        </section>

        <section className="space-y-4 border-t border-line pt-8">
          <h2 className="display text-2xl">Payment</h2>
          <div className="flex items-start gap-3 border border-purple bg-purple-tint p-5">
            <span
              aria-hidden="true"
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-purple"
            />
            <div>
              <p className="text-sm font-medium">Cash on Delivery</p>
              <p className="pt-0.5 text-xs text-ink-muted">
                Pay the courier when your order arrives. No advance payment.
              </p>
            </div>
          </div>
        </section>
      </div>

      <aside className="space-y-5 self-start border border-line bg-surface p-6 lg:sticky lg:top-28">
        <h2 className="eyebrow">Order summary</h2>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd>{formatPrice(subtotal, currencyCode)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Delivery</dt>
            <dd>
              {!shippingKnown ? (
                <span className="text-ink-faint">Select a district</span>
              ) : (
                formatPrice(shipping, currencyCode)
              )}
            </dd>
          </div>
          <div className="flex justify-between border-t border-line pt-3">
            <dt className="font-medium">Total</dt>
            <dd className="display text-2xl tabular-nums">
              {formatPrice(total, currencyCode)}
            </dd>
          </div>
        </dl>


        {errors.form ? (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={submitting}
          size="lg"
          fullWidth
        >
          {submitting ? <Spinner /> : null}
          {submitting ? "Placing order..." : "Place order"}
        </Button>

        <p className="text-xs text-ink-muted">
          You pay {formatPrice(total, currencyCode)} in cash when the order is
          delivered.
        </p>

        <p role="status" aria-live="polite" className="sr-only">
          {submitting ? "Placing your order" : ""}
        </p>
      </aside>
    </form>
  )
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-purple">
            {" "}
            *
          </span>
        ) : (
          ""
        )}
      </label>
      {hint ? (
        <p className="pt-0.5 text-xs text-ink-faint">{hint}</p>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="pt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
