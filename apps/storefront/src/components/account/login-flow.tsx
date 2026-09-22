"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Heart, LockKeyhole, Mail, MapPin, Package } from "lucide-react"

import { Button } from "@/components/ui/button"
import { requestLoginCode, verifyLoginCode } from "@/lib/customer"

/**
 * Passwordless sign-in / sign-up: enter an email, receive a 6-digit code, enter
 * it. The same flow creates an account on first use - there is no password to
 * set. Email ownership is verified by the code.
 */
export default function LoginFlow() {
  const router = useRouter()
  const [step, setStep] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  function sendCode() {
    setError(null)
    start(async () => {
      const r = await requestLoginCode(email)
      if (!r.ok) {
        setError(r.error ?? "Could not send the code.")
        return
      }
      setStep("code")
      setNotice(`We sent a 6-digit code to ${email}. It expires in 10 minutes.`)
      setCooldown(45)
    })
  }

  function verify() {
    setError(null)
    start(async () => {
      const r = await verifyLoginCode(email, code)
      if (!r.ok) {
        setError(r.error ?? "Invalid or expired code.")
        return
      }
      router.push("/account")
      router.refresh()
    })
  }

  return (
    <div className="fl-login">
      <section className="fl-login__intro">
        <Link href="/" className="fl-text-link"><ArrowLeft size={16} /> Back to shopping</Link>
        <div className="fl-login__story">
          <p className="eyebrow text-purple-deep">Your Florayn</p>
          <h1>Good to have <br />you here.</h1>
          <p>Your favourites, your orders. <br />A little space that’s all yours.</p>
        </div>
        <div className="fl-login__benefits">
          <div><Package size={20} /><span><strong>Orders, all together</strong><small>Find your order details in one place.</small></span></div>
          <div><MapPin size={20} /><span><strong>Your details, ready</strong><small>Manage your profile and delivery addresses.</small></span></div>
          <div><Heart size={20} /><span><strong>Keep your favourites close</strong><small>Revisit designs saved on this device.</small></span></div>
        </div>
      </section>
      <section className="fl-login__form" aria-labelledby="login-heading">
        <div className="fl-surface-icon"><Mail size={24} aria-hidden="true" /></div>
        <p className="eyebrow">One email. Your account.</p>
        <h2 id="login-heading">{step === "email" ? "Sign in or join us" : "Check your inbox"}</h2>
        <p className="fl-login__description" aria-live="polite">
          {step === "email" ? "Enter your email to get started. We’ll send a one-time code — no password to remember." : notice}
        </p>

      {step === "email" ? (
        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            sendCode()
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              disabled={pending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-error" : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="fl-account-input"
            />
          </div>
          {error ? <p id="login-error" role="alert" className="fl-form-error">{error}</p> : null}
          <Button type="submit" size="lg" fullWidth className="rounded-full min-h-12" disabled={pending}>
            {pending ? "Sending…" : "Email me a code"}<ArrowRight size={17} aria-hidden="true" />
          </Button>
          <p className="text-center text-xs leading-relaxed text-ink-muted">New here? Your account is created when you verify your email.</p>
        </form>
      ) : (
        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            verify()
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="code" className="text-sm font-medium">
              6-digit code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              disabled={pending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-error" : undefined}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              className="fl-account-input fl-login__code"
            />
          </div>
          {error ? <p id="login-error" role="alert" className="fl-form-error">{error}</p> : null}
          <Button type="submit" size="lg" fullWidth className="rounded-full min-h-12" disabled={pending || code.length !== 6}>
            {pending ? "Verifying…" : "Verify & continue"}<ArrowRight size={17} aria-hidden="true" />
          </Button>
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <button
              type="button"
              disabled={pending}
              className="underline underline-offset-4 hover:text-ink"
              onClick={() => {
                setStep("email")
                setCode("")
                setError(null)
                setNotice(null)
              }}
            >
              Use a different email
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || pending}
              className="underline underline-offset-4 enabled:hover:text-ink disabled:no-underline disabled:opacity-50"
              onClick={sendCode}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}
        <p className="fl-login__privacy"><LockKeyhole size={14} aria-hidden="true" /> Your code is private. Never share it with anyone.</p>
      </section>
    </div>
  )
}
