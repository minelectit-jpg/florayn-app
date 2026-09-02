/**
 * Reading the bundle configuration, and seeding it the first time it is asked
 * for.
 *
 * The settings are a single row. Rather than require a reseed to get one, the
 * first read creates it along with the two live multi-buy tiers, so a fresh
 * database serves the widget immediately and the admin has something to edit.
 */

export type BundleTierRecord = {
  id: string
  quantity: number
  badge: string | null
  discount_amount: number
  min_pct: number
  max_pct: number
  is_enabled: boolean
  sort_order: number
}

/**
 * The two tiers running on florayn.com, read from its `florayn_bundle`
 * options. Tiers 3-6 exist there but are switched off and carry no usable
 * values, so they are not recreated here - add them from the admin instead.
 */
export const DEFAULT_TIERS = [
  {
    quantity: 2,
    badge: "MOST POPULAR",
    discount_amount: 300,
    min_pct: 8,
    max_pct: 12,
    is_enabled: true,
    sort_order: 0,
  },
  {
    quantity: 3,
    badge: "BEST VALUE",
    discount_amount: 800,
    min_pct: 12,
    max_pct: 20,
    is_enabled: true,
    sort_order: 1,
  },
]

export const DEFAULT_SETTINGS = {
  heading: "GET MORE SAVE MORE",
  single_label: "STANDARD PRICE",
  free_shipping_threshold: 3400,
  scope: "cases",
  is_active: true,
}

export async function getBundleConfig(service: any): Promise<{
  settings: any
  tiers: BundleTierRecord[]
}> {
  const existing = await service.listBundleSettings({}, { take: 1 })
  let settings = existing?.[0]

  if (!settings) {
    settings = await service.createBundleSettings(DEFAULT_SETTINGS)
    await service.createBundleTiers(DEFAULT_TIERS)
  }

  const tiers = await service.listBundleTiers(
    {},
    { order: { sort_order: "ASC" } }
  )

  return { settings, tiers: tiers ?? [] }
}
