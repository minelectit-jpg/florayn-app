import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { parseIngestEnvelope } from "../../../lib/tracking/contract"
import { ingest } from "../../../lib/tracking/ingest"
import { verifyIngestKey } from "../../../lib/tracking/secret"

/**
 * POST /tracking/ingest - browser events forwarded by the storefront's
 * /api/t/e/ (TRACKING.md 4.3). Public route like /webhooks/steadfast (not
 * under /store or /admin, so no Medusa auth, publishable key or CORS): the
 * trust is the `x-florayn-ingest-key` header, HMAC-derived from
 * TRACKING_INGEST_SECRET and compared timing-safe; an unset secret rejects
 * everything. The body limit is raised to 512 KB in api/middlewares.ts.
 *
 * Answers 202 `{ accepted }` as soon as one short transaction commits; ad
 * platforms are called later by the outbox, never inside this request. A
 * failure is logged by its code only, because driver messages can quote the
 * inserted values (visitor ids, IPs).
 */
function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code
  const name = (error as { name?: unknown } | null)?.name
  return typeof name === "string" && /^[A-Za-z0-9_]{1,40}$/.test(name) ? name : "error"
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "no-store")
  if (!verifyIngestKey(req.headers["x-florayn-ingest-key"])) return res.status(401).json({})
  const envelope = parseIngestEnvelope(req.body)
  if (!envelope) return res.status(400).json({})
  try {
    const accepted = await ingest(req.scope, envelope)
    res.status(202).json({ accepted })
  } catch (error) {
    req.scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`[tracking] ingest failed: ${failureCode(error)}`)
    // A 5xx makes the storefront retry once and then count sf.forward_failed.
    res.status(503).json({})
  }
}
