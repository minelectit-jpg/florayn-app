import crypto from "node:crypto"
import { Modules } from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"

import { AUTH_OTP_MODULE } from "../modules/auth-otp"
import { sendEmail } from "./send-email"

/**
 * Passwordless email login codes. A 6-digit code is emailed; the plaintext is
 * never stored (only an HMAC), a code is single-use, expires fast, and locks
 * after too many attempts. On success we ensure the caller has a real Medusa
 * emailpass auth identity linked to their customer, with a FRESH random
 * password, and hand that password back so the storefront logs in natively
 * (server-to-server) - the browser only ever receives the resulting session.
 */
const CODE_TTL_MS = 10 * 60 * 1000
const COOLDOWN_MS = 45 * 1000
const MAX_ATTEMPTS = 5

const secret = () =>
  process.env.OTP_SECRET || process.env.JWT_SECRET || "florayn-otp-fallback"

function hashCode(code: string): string {
  return crypto.createHmac("sha256", secret()).update(code).digest("hex")
}

function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
}

/** A strong, ephemeral password the customer never sees (rotated each login). */
function newPassword(): string {
  return crypto.randomBytes(24).toString("base64url") + "Aa1!"
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export function normalizeEmail(raw: unknown): string | null {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  return EMAIL_RE.test(email) ? email : null
}

function otpEmailHtml(code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f2fb;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2fb;padding:32px 0">
   <tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ece7f6">
     <tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:700;color:#1a1625">Florayn</td></tr>
     <tr><td style="padding:0 32px 8px;font-size:15px;color:#4a4458">Your sign-in code is:</td></tr>
     <tr><td style="padding:8px 32px 16px"><div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#7c3aed;font-family:monospace">${code}</div></td></tr>
     <tr><td style="padding:0 32px 28px;font-size:13px;color:#8b8698;line-height:1.5">It expires in 10 minutes. If you did not request this, you can ignore this email &mdash; no account changes were made.</td></tr>
    </table>
    <div style="padding:16px;font-size:11px;color:#a8a4b5">Florayn &middot; printed cases, delivered across Bangladesh</div>
   </td></tr>
  </table></body></html>`
}

export type OtpRequestResult = { ok: boolean; error?: string }
export type OtpVerifyResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string }

/** Issue a fresh code for an email and send it. Always safe to call for any
 *  email (passwordless signup = proving you own the address). */
export async function requestOtp(container: any, rawEmail: unknown): Promise<OtpRequestResult> {
  const email = normalizeEmail(rawEmail)
  if (!email) return { ok: false, error: "Enter a valid email address." }

  const otp: any = container.resolve(AUTH_OTP_MODULE)

  // Recent-send cooldown: don't spam the inbox with back-to-back codes.
  const recent = await otp.listOtpCodes(
    { email },
    { order: { created_at: "DESC" }, take: 1 }
  )
  const last = recent[0]
  if (
    last &&
    !last.consumed_at &&
    Date.now() - new Date(last.created_at).getTime() < COOLDOWN_MS
  ) {
    // A code is already in flight; treat as success without resending.
    return { ok: true }
  }

  // Invalidate any still-open codes so only the newest one works.
  const open = (await otp.listOtpCodes({ email }, { take: 20 })).filter(
    (r: any) => !r.consumed_at
  )
  if (open.length) {
    await otp.updateOtpCodes(
      open.map((r: any) => ({ id: r.id, consumed_at: new Date() }))
    )
  }

  const code = newCode()
  await otp.createOtpCodes({
    email,
    code_hash: hashCode(code),
    expires_at: new Date(Date.now() + CODE_TTL_MS),
    attempts: 0,
  })

  const sent = await sendEmail({
    to: email,
    subject: `${code} is your Florayn sign-in code`,
    html: otpEmailHtml(code),
    text: `Your Florayn sign-in code is ${code}. It expires in 10 minutes.`,
  })
  if (!sent.ok) return { ok: false, error: "Could not send the code. Try again." }
  return { ok: true }
}

/** Verify a code, then ensure a native customer session credential. */
export async function verifyOtp(
  container: any,
  rawEmail: unknown,
  rawCode: unknown
): Promise<OtpVerifyResult> {
  const email = normalizeEmail(rawEmail)
  const code = typeof rawCode === "string" ? rawCode.trim() : ""
  if (!email || !/^\d{6}$/.test(code)) {
    return { ok: false, error: "Invalid or expired code." }
  }

  const otp: any = container.resolve(AUTH_OTP_MODULE)
  const rows = await otp.listOtpCodes(
    { email },
    { order: { created_at: "DESC" }, take: 5 }
  )
  const active = rows.find(
    (r: any) => !r.consumed_at && new Date(r.expires_at) > new Date()
  )
  if (!active) return { ok: false, error: "Invalid or expired code." }

  if ((active.attempts ?? 0) >= MAX_ATTEMPTS) {
    await otp.updateOtpCodes({ id: active.id, consumed_at: new Date() })
    return { ok: false, error: "Too many attempts. Request a new code." }
  }
  if (!safeEqualHex(hashCode(code), active.code_hash)) {
    await otp.updateOtpCodes({ id: active.id, attempts: (active.attempts ?? 0) + 1 })
    return { ok: false, error: "Invalid or expired code." }
  }
  await otp.updateOtpCodes({ id: active.id, consumed_at: new Date() })

  // --- Ensure a real emailpass identity + customer, with a fresh password ---
  const authModule: any = container.resolve(Modules.AUTH)
  const customerModule: any = container.resolve(Modules.CUSTOMER)
  const password = newPassword()

  // updateProvider resets the password if an emailpass identity already exists.
  let authIdentityId: string | undefined
  try {
    const upd = await authModule.updateProvider("emailpass", { entity_id: email, password })
    if (upd?.success) authIdentityId = upd.authIdentity?.id
  } catch {
    // no existing identity - fall through to register
  }
  if (!authIdentityId) {
    const reg = await authModule.register("emailpass", { body: { email, password } })
    if (reg?.success && reg.authIdentity) authIdentityId = reg.authIdentity.id
  }
  if (!authIdentityId) {
    return { ok: false, error: "Could not set up sign-in. Try again." }
  }

  const [existing] = await customerModule.listCustomers({ email }, { take: 1 })
  if (existing) {
    // Link the identity to the existing customer (imported customers had none).
    await authModule.updateAuthIdentities([
      { id: authIdentityId, app_metadata: { customer_id: existing.id } },
    ])
  } else {
    await createCustomerAccountWorkflow(container).run({
      input: { authIdentityId, customerData: { email } },
    })
  }

  return { ok: true, email, password }
}
