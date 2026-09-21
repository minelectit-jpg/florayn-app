import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { courierBalance } from "../../../../lib/steadfast"

/** GET /admin/courier/balance - the current Steadfast account balance (BDT). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const r = await courierBalance(req.scope)
  if (!r.ok) return res.status(400).json({ message: r.error })
  return res.json({ balance: r.balance })
}
