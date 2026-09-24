"use client"

import { useState } from "react"
import { Tag, X } from "lucide-react"

import { applyPromoCode, removePromoCode } from "@/lib/cart"

/**
 * "Have a discount code?" on the checkout: a review reward (REV…) or any other
 * Medusa code. Applying or removing one asks the checkout for a fresh quote,
 * so the total always comes from the server.
 */
export default function PromoCode({ initialCodes, disabled, onChange }: {
  initialCodes: string[]
  disabled?: boolean
  onChange: () => void
}) {
  const [codes, setCodes] = useState(initialCodes)
  const [open, setOpen] = useState(initialCodes.length > 0)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  async function apply() {
    if (busy || !value.trim()) return
    setBusy(true); setMessage("")
    const result = await applyPromoCode(value).catch(() => ({ ok: false as const, message: "Could not check that code. Please try again." }))
    setBusy(false)
    if (!result.ok) { setMessage(result.message); return }
    setCodes(result.codes); setValue(""); onChange()
  }

  async function remove(code: string) {
    if (busy) return
    setBusy(true); setMessage("")
    const result = await removePromoCode(code).catch(() => ({ ok: false as const, message: "Could not remove the code. Please try again." }))
    setBusy(false)
    if (!result.ok) { setMessage(result.message); return }
    setCodes(result.codes); onChange()
  }

  return (
    <div className="checkout-promo">
      {codes.length ? (
        <ul className="checkout-promo__codes" aria-label="Applied codes">
          {codes.map((code) => (
            <li key={code}>
              <Tag size={13} aria-hidden="true" />
              <span>{code}</span>
              <button type="button" onClick={() => remove(code)} disabled={busy || disabled} aria-label={`Remove code ${code}`}><X size={13} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="checkout-promo__row">
          <label htmlFor="promo-code" className="sr-only">Discount code</label>
          <input
            id="promo-code"
            value={value}
            onChange={(e) => { setValue(e.target.value.toUpperCase()); setMessage("") }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void apply() } }}
            placeholder="Discount code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            disabled={busy || disabled}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "promo-code-message" : undefined}
          />
          <button type="button" onClick={apply} disabled={busy || disabled || !value.trim()}>{busy ? "Checking…" : "Apply"}</button>
        </div>
      ) : (
        <button type="button" className="checkout-promo__open" onClick={() => setOpen(true)}>Have a discount code?</button>
      )}
      {message ? <p id="promo-code-message" role="alert" className="checkout-promo__error">{message}</p> : null}
    </div>
  )
}
