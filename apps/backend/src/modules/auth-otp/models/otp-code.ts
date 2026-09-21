import { model } from "@medusajs/framework/utils"

/**
 * A one-time login code for passwordless customer auth. The plaintext code is
 * NEVER stored - only a hash - and a row is single-use (consumed_at) with a
 * short expiry and an attempt counter so a code cannot be brute-forced.
 */
const OtpCode = model.define("otp_code", {
  id: model.id({ prefix: "otp" }).primaryKey(),
  // Lower-cased email the code was issued for.
  email: model.text().index(),
  // HMAC-SHA256 of the code (never the code itself).
  code_hash: model.text(),
  expires_at: model.dateTime(),
  attempts: model.number().default(0),
  consumed_at: model.dateTime().nullable(),
})

export default OtpCode
