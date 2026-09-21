"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { requestLoginCode, verifyLoginCode } from "@/lib/customer"

/**
 * Passwordless sign-in / sign-up: enter an email, receive a 6-digit code, enter
 * it. The same flow creates an account on first use - there is no password to
 * set. The emailed code IS the second factor.
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
    <div className="mx-auto w-full max-w-sm">
      <div className="space-y-2 text-center">
        <p className="eyebrow">Account</p>
        <h1 className="display text-[2rem] leading-tight">
          {step === "email" ? "Sign in or create an account" : "Enter your code"}
        </h1>
        <p className="text-sm text-ink-muted">
          {step === "email"
            ? "No password needed — we'll email you a one-time code."
            : notice}
        </p>
      </div>

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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-[10px] border border-line-strong bg-paper px-4 py-3 text-sm outline-none focus:border-ink"
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" size="lg" fullWidth disabled={pending}>
            {pending ? "Sending…" : "Email me a code"}
          </Button>
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
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              className="w-full rounded-[10px] border border-line-strong bg-paper px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-ink"
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" size="lg" fullWidth disabled={pending || code.length !== 6}>
            {pending ? "Verifying…" : "Sign in"}
          </Button>
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <button
              type="button"
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
    </div>
  )
}
