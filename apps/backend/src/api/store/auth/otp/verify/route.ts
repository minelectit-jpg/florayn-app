import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { verifyOtp } from "../../../../../lib/otp"

/**
 * POST /store/auth/otp/verify { email, code } - verify the code and, on
 * success, return a native Medusa CUSTOMER session token. The storefront server
 * stores it in an httpOnly cookie and sends it as a Bearer token on the
 * customer's behalf. No password is ever set or exposed.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { email?: unknown; code?: unknown }
  const result = await verifyOtp(req.scope, body.email, body.code)
  if (!result.ok) {
    res.status(400).json({ success: false, message: result.error })
    return
  }
  res.json({
    success: true,
    email: result.email,
    token: result.token,
    customer_id: result.customerId,
  })
}
