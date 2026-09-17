import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { revalidateStorefront } from "../../../lib/revalidate-storefront"

/**
 * POST /admin/revalidate-storefront - the "Refresh storefront" button. Flushes
 * the storefront's ISR cache so every published change is live at once. Content
 * saves already trigger this automatically (see api/middlewares.ts); this is the
 * manual/bulk button for after an import or if an auto-refresh was missed.
 */
export const POST = async (_req: MedusaRequest, res: MedusaResponse) => {
  const configured = Boolean(
    process.env.STOREFRONT_URL && process.env.REVALIDATE_SECRET
  )
  const ok = await revalidateStorefront()
  res.json({ ok, configured })
}
