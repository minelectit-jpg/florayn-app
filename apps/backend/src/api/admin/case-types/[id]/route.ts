import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../../modules/catalog"
import { repriceCaseType } from "../../../../lib/reprice-case-type"

/**
 * POST /admin/case-types/:id - update one case type.
 *
 * `price` is the important one: a change re-prices every variant of this case
 * type across the catalogue (see repriceCaseType), so the new price is what
 * customers actually pay. `description` updates the record (shown on the PDP).
 *
 * The NAME is deliberately not editable here: it is baked into every variant's
 * "Case Type" option value at seed time, so renaming the record alone would
 * desync it from the variants (and from the reprice match). Renames need a
 * catalogue re-sync, not a field edit.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = (req.body ?? {}) as {
    description?: string
    price?: number
    image_url?: string | null
  }

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const existing = await catalog.retrieveCaseType(id)

  const update: Record<string, unknown> = { id }
  if (typeof body.description === "string") update.description = body.description
  // The "Shop by style" menu photo. Empty string clears it.
  if (typeof body.image_url === "string" || body.image_url === null)
    update.image_url = body.image_url ? body.image_url.trim() : null

  const wantsReprice =
    Number.isFinite(body.price) &&
    (body.price as number) > 0 &&
    body.price !== existing.price
  if (wantsReprice) update.price = body.price

  const [caseType] = await catalog.updateCaseTypes([update])

  let repriced: { variants: number; products: number } | null = null
  if (wantsReprice) {
    // Match variants by the name they actually carry (unchanged, since name is
    // not editable here).
    repriced = await repriceCaseType({
      container: req.scope,
      caseTypeName: existing.name,
      amount: body.price as number,
    })
  }

  res.json({ case_type: caseType, repriced })
}
