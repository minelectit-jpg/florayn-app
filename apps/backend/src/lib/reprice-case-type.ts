import { Modules } from "@medusajs/framework/utils"
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { CATALOG_MODULE } from "../modules/catalog"
import { rebuildCards } from "./rebuild-cards"

export type PriceGroup = {
  label?: string
  price: number
  /** Device SLUGS this group's price applies to. */
  devices: string[]
}

/**
 * Re-price every variant of a case type across the whole catalogue.
 *
 * In Structure B "Case Type" is a product OPTION, and each variant carries its
 * own price record - so changing a case type's headline price in the catalog
 * table does nothing to what customers pay. This walks every product, finds the
 * variants whose Case Type option is this one, and updates their price. It is
 * the workflow behind the admin Case Types screen's price field.
 *
 * Flat by default: `amount` is applied to every variant, which is correct for
 * the five flat constructions. Pass `priceGroups` (Alcantara) to price each
 * variant by its DEVICE instead - a variant whose device is in a group gets
 * that group's price; a device in no group falls back to `amount`.
 */
export async function repriceCaseType({
  container,
  caseTypeName,
  amount,
  currencyCode = "bdt",
  priceGroups,
}: {
  container: any
  caseTypeName: string
  amount: number
  currencyCode?: string
  priceGroups?: PriceGroup[] | null
}): Promise<{ variants: number; products: number }> {
  const productModule = container.resolve(Modules.PRODUCT)
  const perDevice = Array.isArray(priceGroups) && priceGroups.length > 0

  // A variant's Device option carries the device NAME; the groups key on slug,
  // so resolve a name -> slug map once (only when pricing per device).
  const deviceSlugByName = new Map<string, string>()
  if (perDevice) {
    const catalog: any = container.resolve(CATALOG_MODULE)
    const devices = await catalog.listDevices(
      {},
      { select: ["name", "slug"], take: 1000 }
    )
    for (const d of devices) deviceSlugByName.set(d.name, d.slug)
  }
  const priceForDeviceName = (deviceName: string): number => {
    if (!perDevice) return amount
    const slug = deviceSlugByName.get(deviceName)
    const group = slug
      ? priceGroups!.find((g) => g.devices.includes(slug))
      : undefined
    return group ? group.price : amount
  }

  const products = await productModule.listProducts(
    {},
    {
      select: ["id"],
      relations: ["variants", "variants.options", "options"],
      take: 5000,
    }
  )

  const updates: { id: string; prices: { amount: number; currency_code: string }[] }[] = []
  const productIds: string[] = []
  for (const product of products) {
    const optionTitleById = new Map<string, string>(
      (product.options ?? []).map((o: any) => [o.id, o.title])
    )
    let touched = false
    for (const variant of product.variants ?? []) {
      const opts = variant.options ?? []
      const ct = opts.find(
        (o: any) => optionTitleById.get(o.option_id) === "Case Type"
      )?.value
      if (ct !== caseTypeName) continue
      const deviceName =
        opts.find((o: any) => optionTitleById.get(o.option_id) === "Device")
          ?.value ?? ""
      updates.push({
        id: variant.id,
        prices: [{ amount: priceForDeviceName(deviceName), currency_code: currencyCode }],
      })
      touched = true
    }
    if (touched) productIds.push(product.id)
  }

  if (updates.length) {
    await updateProductVariantsWorkflow(container).run({
      input: { product_variants: updates },
    })
  }

  if (productIds.length) await rebuildCards(container, { productIds })
  return { variants: updates.length, products: productIds.length }
}
