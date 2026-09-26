/**
 * Availability as the shop shows it, shared by GET /store/stock, the tracking
 * variant index and the catalog feed (TRACKING.md 8.2), so an ad never says
 * "in stock" for something the product page greys out, or the other way round.
 *
 * Two shapes, exactly as /store/stock has always returned them:
 * - blankAvailability: per BLANK (case type x device), keyed
 *   "<Case Type name>|<Device name>". Stock is shared across every design
 *   printed on a blank, so one number decides sold-out for all of them.
 * - variantAvailability: per variant of one regular (non-case) product, keyed
 *   "variant:<id>". Variants that do not track stock, or allow backorders,
 *   are left out.
 *
 * The storefront treats a missing key as available (isAvailable below).
 */

export type StockMap = Record<string, number>

type Query = { graph: (input: any) => Promise<{ data: any[] }> }

export function blankKey(caseTypeName: string, deviceName: string): string {
  return `${caseTypeName}|${deviceName}`
}

export function variantKey(variantId: string): string {
  return `variant:${variantId}`
}

/** The buy box's reading of the map: a key that is missing is not tracked, so it is available. */
export function isAvailable(stock: StockMap, key: string): boolean {
  return (stock[key] ?? Infinity) > 0
}

/** Stock per blank, from the blank inventory items' case_type_name / device_name metadata. */
export async function blankAvailability(query: Query): Promise<StockMap> {
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: [
      "metadata",
      "location_levels.stocked_quantity",
      "location_levels.reserved_quantity",
    ],
  })

  const stock: StockMap = {}
  for (const it of items) {
    const ct = (it as any).metadata?.case_type_name
    const dev = (it as any).metadata?.device_name
    if (!ct || !dev) continue
    let available = 0
    for (const lvl of (it as any).location_levels ?? []) {
      available += (lvl.stocked_quantity ?? 0) - (lvl.reserved_quantity ?? 0)
    }
    stock[blankKey(ct, dev)] = Math.max(0, available)
  }
  return stock
}

/** Stock per variant of one published regular product; the handle is validated by the caller. */
export async function variantAvailability(query: Query, handle: string): Promise<StockMap> {
  const { data: products } = await query.graph({ entity: "product", filters: { handle, status: "published" }, fields: [
    "id", "variants.id", "variants.manage_inventory", "variants.allow_backorder",
    "variants.inventory_items.required_quantity", "variants.inventory_items.inventory.location_levels.stocked_quantity",
    "variants.inventory_items.inventory.location_levels.reserved_quantity",
  ] })
  const stock: StockMap = {}
  for (const v of (products[0] as any)?.variants ?? []) {
    if (!v.manage_inventory || v.allow_backorder) continue
    const available = (v.inventory_items ?? []).map((item: any) => {
      const total = (item.inventory?.location_levels ?? []).reduce((n: number, l: any) => n + Math.max(0, Number(l.stocked_quantity) - Number(l.reserved_quantity)), 0)
      return Math.floor(total / Math.max(1, Number(item.required_quantity ?? 1)))
    })
    stock[variantKey(v.id)] = available.length ? Math.min(...available) : 0
  }
  return stock
}
