import crypto from "node:crypto"
import {
  ContainerRegistrationKeys,
  Modules,
  generateJwtToken,
} from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"

import { AUTH_OTP_MODULE } from "../modules/auth-otp"
import { sendEmail } from "./send-email"

/**
 * Passwordless email login codes. A 6-digit code is emailed; the plaintext is
 * never stored (only an HMAC), a code is single-use, expires fast, and locks
 * after too many attempts. On success we mint a native Medusa CUSTOMER session
 * token directly from the auth identity and hand THAT back - we never set or
 * rotate an emailpass password. This matters because one email (the owner's)
 * can be BOTH an admin user and a customer sharing a single emailpass identity;
 * rewriting its password to log a customer in would lock the admin out. So the
 * flow below only ever mints a signed customer JWT and links the customer.
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

/**
 * A strong random password used ONCE when we have to create a brand-new
 * emailpass identity (Medusa requires one). It is never returned to anyone and
 * never rotated afterwards - customers authenticate with the emailed code, not
 * this password, so it stays inert for the life of the identity.
 */
function newPassword(): string {
  return crypto.randomBytes(24).toString("base64url") + "Aa1!"
}

const EMAILPASS = "emailpass"

/** Find the existing emailpass auth identity for an email (or undefined). */
async function findEmailpassIdentity(
  authModule: any,
  email: string
): Promise<any | undefined> {
  const list = await authModule.listAuthIdentities(
    { provider_identities: { entity_id: email, provider: EMAILPASS } },
    { relations: ["provider_identities"] }
  )
  return Array.isArray(list) ? list[0] : undefined
}

/** Re-read an identity with its provider identities (or undefined on failure). */
async function retrieveIdentity(
  authModule: any,
  id: string
): Promise<any | undefined> {
  try {
    return await authModule.retrieveAuthIdentity(id, {
      relations: ["provider_identities"],
    })
  } catch {
    return undefined
  }
}

/**
 * Mint a native Medusa customer session JWT for an auth identity, identical in
 * shape to what Medusa's own login issues (verified by the auth middleware as a
 * Bearer token). No password is involved.
 */
function mintCustomerToken(
  container: any,
  authIdentity: any,
  customerId: string
): string {
  const config: any = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const http = config?.projectConfig?.http ?? {}
  const providerIdentity = (authIdentity.provider_identities ?? []).find(
    (pi: any) => pi.provider === EMAILPASS
  )
  return generateJwtToken(
    {
      actor_id: customerId,
      actor_type: "customer",
      auth_identity_id: authIdentity.id,
      auth_provider: EMAILPASS,
      app_metadata: {
        ...(authIdentity.app_metadata ?? {}),
        customer_id: customerId,
      },
      user_metadata: providerIdentity?.user_metadata ?? {},
    },
    {
      secret: http.jwtSecret,
      expiresIn: http.jwtExpiresIn ?? "1d",
      jwtOptions: http.jwtOptions,
    }
  )
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
  | { ok: true; email: string; token: string; customerId: string }
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

/** Verify a code, then mint a native customer session token (no password). */
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

  // --- Passwordless customer session (NEVER touches any emailpass password) ---
  const authModule: any = container.resolve(Modules.AUTH)
  const customerModule: any = container.resolve(Modules.CUSTOMER)

  // 1) Use the existing emailpass identity if there is one. We do NOT create a
  //    password here; a shared admin+customer identity is left byte-for-byte
  //    intact, which is the whole point of this rewrite.
  let authIdentity = await findEmailpassIdentity(authModule, email)

  // 2) Only when none exists do we create one, with a one-time inert password.
  //    register() refuses (without modifying anything) if an identity is already
  //    claimed, so this can never overwrite an admin's password.
  if (!authIdentity) {
    try {
      const reg = await authModule.register(EMAILPASS, {
        body: { email, password: newPassword() },
      })
      if (reg?.authIdentity?.id) {
        authIdentity = await retrieveIdentity(authModule, reg.authIdentity.id)
      }
    } catch {
      // race or already-exists - fall through to a re-lookup
    }
    if (!authIdentity) authIdentity = await findEmailpassIdentity(authModule, email)
  }
  if (!authIdentity?.id) {
    return { ok: false, error: "Could not set up sign-in. Try again." }
  }

  // 3) Make sure the identity is linked to a customer. If it already is (e.g.
  //    the owner's shared identity), we leave it untouched entirely.
  let customerId: string | undefined = authIdentity.app_metadata?.customer_id
  if (!customerId) {
    const [existing] = await customerModule.listCustomers({ email }, { take: 1 })
    if (existing) {
      // Imported customers exist without an auth identity - link them.
      await authModule.updateAuthIdentities([
        {
          id: authIdentity.id,
          app_metadata: {
            ...(authIdentity.app_metadata ?? {}),
            customer_id: existing.id,
          },
        },
      ])
      customerId = existing.id
    } else {
      // Brand-new signup: create the customer and link it to the identity.
      await createCustomerAccountWorkflow(container).run({
        input: { authIdentityId: authIdentity.id, customerData: { email } },
      })
    }
    authIdentity = (await retrieveIdentity(authModule, authIdentity.id)) ?? authIdentity
    customerId = authIdentity.app_metadata?.customer_id ?? customerId
  }
  if (!customerId) {
    return { ok: false, error: "Could not set up your account. Try again." }
  }

  // 4) Mint a signed customer session token directly - no password anywhere.
  const token = mintCustomerToken(container, authIdentity, customerId)
  return { ok: true, email, token, customerId }
}
