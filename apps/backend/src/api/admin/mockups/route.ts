import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../../../modules/catalog"
import { MOCKUP_KEY, readMockupSettings, validateMockupSettings } from "../../../lib/mockup-settings"
import { colourUsage } from "../../../lib/phone-colours"

async function catalogChoices(container: any) {
  const catalog = container.resolve(CATALOG_MODULE)
  const [devices, caseTypes, colourRows] = await Promise.all([
    catalog.listDevices({}, { order: { sort_order: "ASC" }, take: 1000 }),
    catalog.listCaseTypes({}, { order: { sort_order: "ASC" }, take: 1000 }),
    // Two short columns per row (about 14,400 rows at full scale), so the sets
    // screen can warn before a used phone colour is removed.
    catalog.listPhoneColourGalleries({}, { select: ["device_slug", "colour_slug"], take: 100000 }),
  ])
  return {
    devices: devices.map((d: any) => ({ slug: d.slug, name: d.name, family: d.family, is_active: d.is_active !== false })),
    case_types: caseTypes.map((c: any) => ({ slug: c.slug, name: c.name, price: c.price })),
    // device slug -> colour slug -> phone colour picture rows (one per variant)
    colour_usage: colourUsage(colourRows),
  }
}

/** GET /admin/mockups - Mockup Studio settings plus the models and case types to choose from. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const [{ settings }, choices] = await Promise.all([readMockupSettings(req.scope), catalogChoices(req.scope)])
  res.json({ settings, ...choices })
}

/**
 * POST /admin/mockups - save the settings and mockup sets (validated against
 * the live catalog). The palette (colours, names, swatches, default colour) is
 * what the shop shows, so this write refreshes the storefront's catalog.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const [{ store }, choices] = await Promise.all([readMockupSettings(req.scope), catalogChoices(req.scope)])
  if (!store) return res.status(409).json({ message: "Create the store before saving Mockup Studio settings." })
  let settings
  try { settings = validateMockupSettings(req.body, choices.case_types, choices.devices) }
  catch (error: any) { return res.status(400).json({ message: error.message }) }
  await updateStoresWorkflow(req.scope).run({ input: {
    selector: { id: store.id },
    update: { metadata: { ...store.metadata, [MOCKUP_KEY]: settings } },
  } })
  res.json({ settings, ...choices })
}
