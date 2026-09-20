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
    /** Per-device overrides (Alcantara): [{ label, price, devices: [slug] }]. */
    price_groups?: { label?: string; price?: number; devices?: unknown }[]
  }

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const existing = await catalog.retrieveCaseType(id)

  const update: Record<string, unknown> = { id }
  if (typeof body.description === "string") update.description = body.description
  // The "Shop by style" menu photo. Empty string clears it.
  if (typeof body.image_url === "string" || body.image_url === null)
    update.image_url = body.image_url ? body.image_url.trim() : null

  const flatChanged =
    Number.isFinite(body.price) &&
    (body.price as number) > 0 &&
    body.price !== existing.price
  if (flatChanged) update.price = body.price
  // The base/flat price the per-device reprice falls back to for a device in no
  // group (Alcantara's phone shells): the new flat price if it changed, else the
  // current one.
  const basePrice = flatChanged ? (body.price as number) : existing.price

  // Clean the per-device groups: keep only positive prices and string slugs.
  let priceGroups: { label?: string; price: number; devices: string[] }[] | null = null
  const hasGroups = Array.isArray(body.price_groups)
  if (hasGroups) {
    priceGroups = (body.price_groups ?? [])
      .map((g) => ({
        label: typeof g.label === "string" && g.label.trim() ? g.label.trim() : undefined,
        price: Number(g.price),
        devices: Array.isArray(g.devices)
          ? g.devices.filter((d): d is string => typeof d === "string")
          : [],
      }))
      .filter((g) => Number.isFinite(g.price) && g.price > 0 && g.devices.length > 0)
    // Persist the groups (null when cleared) so create paths and the screen read
    // them from the DB instead of the seed constant.
    update.price_groups = priceGroups.length ? priceGroups : null
  }

  const wantsReprice = flatChanged || hasGroups
  const [caseType] = await catalog.updateCaseTypes([update])

  let repriced: { variants: number; products: number } | null = null
  if (wantsReprice) {
    // Match variants by the name they actually carry (unchanged, since name is
    // not editable here). Per-device when groups are set, flat otherwise.
    repriced = await repriceCaseType({
      container: req.scope,
      caseTypeName: existing.name,
      amount: basePrice,
      priceGroups: priceGroups && priceGroups.length ? priceGroups : null,
    })
  }

  res.json({ case_type: caseType, repriced })
}
