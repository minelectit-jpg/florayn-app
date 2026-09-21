import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../modules/catalog"
import { skuCodeFromSlug, slugify } from "../../../lib/create-uploaded-design"

const FAMILIES = ["iphone", "samsung", "airpods", "watch", "wallet"] as const
const DEFAULT_BRAND: Record<string, string> = { iphone: "Apple", samsung: "Samsung", airpods: "Apple", watch: "Apple", wallet: "" }

/**
 * GET /admin/devices - every device, active or not, for the admin screen where
 * an admin turns devices on and off. The storefront's /store/devices only ever
 * returns is_active ones, so deactivating a device here removes it from the site
 * without touching code (this is how a "dummy" device is retired).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const devices = await catalog.listDevices(
    {},
    { order: { sort_order: "ASC" } }
  )
  res.json({ devices, count: devices.length })
}

/**
 * POST /admin/devices - add a new model. `family` (iphone / samsung / airpods /
 * watch / wallet) decides which product form its cases sell under and how it is
 * grouped in the pickers. Created active so it is immediately usable.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { name?: unknown; family?: unknown; brand?: unknown; sku_code?: unknown }
  const name = typeof body.name === "string" ? body.name.trim() : ""
  const family = typeof body.family === "string" ? body.family.trim() : ""
  if (!name) return res.status(400).json({ message: "A model name is required." })
  if (!(FAMILIES as readonly string[]).includes(family)) {
    return res.status(400).json({ message: `family must be one of: ${FAMILIES.join(", ")}.` })
  }
  const slug = slugify(name)
  if (!slug) return res.status(400).json({ message: "Could not derive a slug from the name." })
  const sku_code = ((typeof body.sku_code === "string" && body.sku_code.trim()) || skuCodeFromSlug(slug)).toUpperCase()
  const brand = (typeof body.brand === "string" && body.brand.trim()) || DEFAULT_BRAND[family] || ""

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const existing = await catalog.listDevices({ slug })
  if (existing.length) return res.status(400).json({ message: `A model "${slug}" already exists.` })
  const all = await catalog.listDevices({})
  try {
    const [created] = await catalog.createDevices([
      { slug, name, family, brand, sku_code, sort_order: all.length, is_active: true },
    ])
    res.json({ ok: true, device: created })
  } catch (error: any) {
    req.scope.resolve("logger").error(`[create-device] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
}
