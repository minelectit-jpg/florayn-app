import { setTimeout as delay } from "node:timers/promises"

/**
 * Minimal transactional-email sender for emailit.com (v2 API), modelled on the
 * bounded, authenticated fetch in revalidate-storefront.ts. Used for the
 * customer login codes (and any future transactional mail).
 *
 * Config (env, never hard-coded):
 *   EMAILIT_API_KEY  - the "secret_..." key; sent as `Authorization: Bearer`.
 *   EMAIL_FROM       - the From header, RFC form "Florayn <hello@florayn.com>".
 *                      Its DOMAIN must be DNS-verified (SPF+DKIM) in emailit or
 *                      every send is rejected.
 *
 * Never logs the key or the email body (a login code is a secret).
 */
const EMAILIT_ENDPOINT = "https://api.emailit.com/v2/emails"
const REQUEST_TIMEOUT_MS = 8_000

export type EmailInput = {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export type EmailResult = { ok: boolean; error?: string }

/** True only when the key and From address are both configured. */
export function emailConfigured(): boolean {
  return Boolean(process.env.EMAILIT_API_KEY && process.env.EMAIL_FROM)
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const key = process.env.EMAILIT_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) {
    return { ok: false, error: "email not configured (EMAILIT_API_KEY/EMAIL_FROM)" }
  }

  const body = {
    from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
  }

  // A couple of bounded attempts, backing off only on rate limit / transport.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(EMAILIT_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.ok) return { ok: true }
      // 4xx (except 429) is a permanent problem - stop, but do not leak details.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, error: `emailit rejected the send (${res.status})` }
      }
    } catch {
      // transport/timeout - retry within the bounded loop
    }
    if (attempt < 2) await delay(300 * (attempt + 1))
  }
  return { ok: false, error: "emailit send failed after retries" }
}
