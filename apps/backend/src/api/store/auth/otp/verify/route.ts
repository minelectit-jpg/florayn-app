import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { verifyOtp } from "../../../../../lib/otp"

/**
 * POST /store/auth/otp/verify { email, code } - verify the code and, on
 * success, return the ephemeral emailpass credential the STOREFRONT SERVER uses
 * (server-to-server) to complete a native Medusa customer login. The browser
 * never receives this; only the resulting session cookie.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { email?: unknown; code?: unknown }
  const result = await verifyOtp(req.scope, body.email, body.code)
  if (!result.ok) {
    res.status(400).json({ success: false, message: result.error })
    return
  }
  res.json({ success: true, email: result.email, password: result.password })
}
