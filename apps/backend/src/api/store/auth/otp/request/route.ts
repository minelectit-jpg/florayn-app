import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { requestOtp } from "../../../../../lib/otp"

/**
 * POST /store/auth/otp/request { email } - email a fresh 6-digit sign-in code.
 * Safe for any email (passwordless signup = proving you own the address); the
 * response never reveals whether an account exists.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const email = (req.body as { email?: unknown } | undefined)?.email
  const result = await requestOtp(req.scope, email)
  if (!result.ok) {
    res.status(400).json({ success: false, message: result.error ?? "Could not send the code." })
    return
  }
  res.json({ success: true })
}
