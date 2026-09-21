import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../modules/catalog"
import { CASE_TYPES, type CaseTypeSeed } from "../modules/catalog/data/case-types"
import { DEVICES, type DeviceFamily } from "../modules/catalog/data/devices"
import { skuCodeFromSlug, type UploadedPairs } from "./create-uploaded-design"
import { rebuildCards } from "./rebuild-cards"

const CURRENCY = "bdt"
type ProductForm = "phone" | "airpods" | "watch" | "wallet"
const FORM_BY_FAMILY: Record<DeviceFamily, ProductForm> = {
  iphone: "phone",
  samsung: "phone",
  airpods: "airpods",
  watch: "watch",
  wallet: "wallet",
}
const CASE_TYPE_OPTION = "Case Type"
const DEVICE_OPTION = "Device"

export type AddPairsResult = {
  ok: true
  variantsAdded: number
  skipped: number
  skippedForms: string[]
}

/**
 * Add new (case type × device) variants - with images - to an EXISTING design,
 * without recreating its products (recreating would change variant ids and
 * orphan cart/order line items). Mirrors create-uploaded-design's pricing,
 * blank sharing and AirPods remap, but APPENDS: it adds any missing option
 * values first (variants can only reference existing values), then creates only
 * the pairs that are not already variants, then extends the gallery and rebuilds
 * the cards. Forms with no product yet are skipped (create those via upload).
 */
export async function addPairsToDesign(
  container: any,
  slug: string,
  pairs: UploadedPairs,
  blankStock = 10
): Promise<AddPairsResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule = container.resolve(Modules.PRODUCT)
  const inventoryModule = container.resolve(Modules.INVENTORY)
  const catalog: any = container.resolve(CATALOG_MODULE)

  // Start from the code seed, then overlay the DB catalog so admin-created case
  // types / models (which only live in the DB) work too. The DB is the source of
  // truth for price, sku_code and family; the seed is a defensive fallback.
  const caseTypeSeedBySlug = new Map<string, CaseTypeSeed>(CASE_TYPES.map((c) => [c.slug, c]))
  const deviceSeedBySlug = new Map<string, any>(DEVICES.map((d) => [d.slug, d]))
  const [dbCaseTypes, dbDevices] = await Promise.all([catalog.listCaseTypes({}), catalog.listDevices({})])
  for (const c of dbCaseTypes as any[]) {
    caseTypeSeedBySlug.set(c.slug, { slug: c.slug, name: c.name, sku_code: c.sku_code, price: c.price, price_groups: (c.price_groups as any[] | null) ?? null } as any)
  }
  for (const d of dbDevices as any[]) {
    deviceSeedBySlug.set(d.slug, { slug: d.slug, name: d.name, family: d.family, sku_code: d.sku_code, brand: d.brand ?? "" })
  }
  const earbudsCt = caseTypeSeedBySlug.get("signature-earbuds")
  const remapCt = (seed: CaseTypeSeed, form: ProductForm): CaseTypeSeed =>
    form === "airpods" && seed.slug === "signature" && earbudsCt ? earbudsCt : seed

  // Validate + flatten the requested pairs (drop empties).
  const flat: { caseTypeSlug: string; deviceSlug: string; images: string[]; form: ProductForm }[] = []
  for (const [caseTypeSlug, devices] of Object.entries(pairs ?? {})) {
    if (!caseTypeSeedBySlug.has(caseTypeSlug)) throw new Error(`Unknown case type "${caseTypeSlug}".`)
    for (const [deviceSlug, urls] of Object.entries(devices ?? {})) {
      const dev = deviceSeedBySlug.get(deviceSlug)
      if (!dev) throw new Error(`Unknown device "${deviceSlug}".`)
      const images = (urls ?? []).filter((u) => typeof u === "string" && u.length)
      if (images.length) flat.push({ caseTypeSlug, deviceSlug, images, form: FORM_BY_FAMILY[dev.family] })
    }
  }
  if (!flat.length) throw new Error("No images were provided for any pair.")

  // Load the design's products with options + variants.
  const handles = [slug, `${slug}-airpods`, `${slug}-watch`, `${slug}-wallet`]
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id", "handle", "metadata",
      "images.url",
      "options.id", "options.title", "options.values.id", "options.values.value",
      "variants.id", "variants.options.option_id", "variants.options.value",
    ],
    filters: { handle: handles },
  })
  const mine = (products ?? []).filter((p: any) => p.metadata?.design_slug === slug)
  if (!mine.length) throw new Error(`No design found for "${slug}".`)
  const productByForm = new Map<ProductForm, any>(mine.map((p: any) => [(p.metadata?.form as ProductForm) ?? "phone", p]))

  // Price from the (DB-backed) case type: a per-device group override, else flat.
  const priceFor = (caseTypeSlug: string, deviceSlug: string): number => {
    const seed: any = caseTypeSeedBySlug.get(caseTypeSlug)
    const group = seed?.price_groups?.find((g: any) => g.devices.includes(deviceSlug))
    if (group) return group.price
    return seed?.price ?? 0
  }

  // --- Ensure shared blanks exist for the new pairs (reuse by SKU) ---
  const skuFor = (caseTypeSlug: string, deviceSlug: string) =>
    `${caseTypeSeedBySlug.get(caseTypeSlug)!.sku_code}-${deviceSeedBySlug.get(deviceSlug)!.sku_code}`
  const wantedSkus = [...new Set(flat.map((p) => skuFor(p.caseTypeSlug, p.deviceSlug)))]
  const existingBlanks = await inventoryModule.listInventoryItems({ sku: wantedSkus })
  const blankIdBySku = new Map<string, string>((existingBlanks as any[]).map((b) => [b.sku, b.id]))
  const missingBySku = new Map<string, { caseTypeSlug: string; deviceSlug: string; form: ProductForm }>()
  for (const p of flat) if (!blankIdBySku.has(skuFor(p.caseTypeSlug, p.deviceSlug))) missingBySku.set(skuFor(p.caseTypeSlug, p.deviceSlug), p)
  if (missingBySku.size) {
    const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"] })
    const stockLocationId = locations?.[0]?.id
    const { result: created } = await createInventoryItemsWorkflow(container).run({
      input: {
        items: [...missingBySku.values()].map(({ caseTypeSlug, deviceSlug, form }) => {
          const dev = deviceSeedBySlug.get(deviceSlug)!
          const ct = remapCt(caseTypeSeedBySlug.get(caseTypeSlug)!, form)
          return {
            sku: skuFor(caseTypeSlug, deviceSlug),
            title: `${ct.name} - ${dev.name}`,
            metadata: { case_type_slug: ct.slug, case_type_name: ct.name, device_slug: deviceSlug, device_name: dev.name, is_blank: true },
          }
        }),
      },
    })
    for (const item of created as any[]) blankIdBySku.set(item.sku, item.id)
    if (stockLocationId) {
      await createInventoryLevelsWorkflow(container).run({
        input: { inventory_levels: (created as any[]).map((item) => ({ location_id: stockLocationId, inventory_item_id: item.id, stocked_quantity: blankStock })) },
      })
    }
  }

  // --- Per form: add option values, then create the new variants ---
  const skuCode = skuCodeFromSlug(slug)
  let variantsAdded = 0
  let skipped = 0
  const skippedForms = new Set<string>()
  const touchedProductIds: string[] = []

  const byForm = new Map<ProductForm, typeof flat>()
  for (const p of flat) byForm.set(p.form, [...(byForm.get(p.form) ?? []), p])

  for (const [form, formPairs] of byForm) {
    const product = productByForm.get(form)
    if (!product) {
      skipped += formPairs.length
      skippedForms.add(form)
      continue
    }
    const ctOpt = (product.options ?? []).find((o: any) => o.title === CASE_TYPE_OPTION)
    const devOpt = (product.options ?? []).find((o: any) => o.title === DEVICE_OPTION)
    if (!ctOpt || !devOpt) {
      skipped += formPairs.length
      skippedForms.add(form)
      continue
    }

    // Existing variant pairs, keyed by "caseTypeName|deviceName", to skip dupes.
    const existingPairKeys = new Set<string>()
    for (const v of product.variants ?? []) {
      const map = new Map<string, string>((v.options ?? []).map((o: any) => [o.option_id, o.value]))
      existingPairKeys.add(`${map.get(ctOpt.id)}|${map.get(devOpt.id)}`)
    }

    // Resolve the display names (remap AirPods signature) + gather needed values.
    const neededCtValues = new Set<string>()
    const neededDevValues = new Set<string>()
    const toCreate: { caseTypeSlug: string; deviceSlug: string; ctName: string; devName: string; images: string[] }[] = []
    for (const { caseTypeSlug, deviceSlug, images } of formPairs) {
      const ct = remapCt(caseTypeSeedBySlug.get(caseTypeSlug)!, form)
      const dev = deviceSeedBySlug.get(deviceSlug)!
      const key = `${ct.name}|${dev.name}`
      if (existingPairKeys.has(key)) {
        skipped += 1
        continue
      }
      neededCtValues.add(ct.name)
      neededDevValues.add(dev.name)
      toCreate.push({ caseTypeSlug, deviceSlug, ctName: ct.name, devName: dev.name, images })
    }
    if (!toCreate.length) continue

    // Add any missing option values. Pass BOTH options with their full value
    // lists (existing by id + new by value) so upsertWithReplace keeps the
    // existing values/variants and only adds what is new.
    const ctValueSet = new Set<string>((ctOpt.values ?? []).map((v: any) => v.value))
    const devValueSet = new Set<string>((devOpt.values ?? []).map((v: any) => v.value))
    const newCt = [...neededCtValues].filter((v) => !ctValueSet.has(v))
    const newDev = [...neededDevValues].filter((v) => !devValueSet.has(v))
    if (newCt.length || newDev.length) {
      await productModule.updateProducts(product.id, {
        options: [
          {
            id: ctOpt.id,
            title: CASE_TYPE_OPTION,
            values: [...(ctOpt.values ?? []).map((v: any) => ({ id: v.id, value: v.value })), ...newCt.map((value) => ({ value }))],
          },
          {
            id: devOpt.id,
            title: DEVICE_OPTION,
            values: [...(devOpt.values ?? []).map((v: any) => ({ id: v.id, value: v.value })), ...newDev.map((value) => ({ value }))],
          },
        ],
      })
    }

    // Create the new variants.
    await createProductVariantsWorkflow(container).run({
      input: {
        product_variants: toCreate.map(({ caseTypeSlug, deviceSlug, ctName, devName, images }) => ({
          product_id: product.id,
          title: `${ctName} / ${devName}`,
          sku: `${skuCode}-${caseTypeSeedBySlug.get(caseTypeSlug)!.sku_code}-${deviceSeedBySlug.get(deviceSlug)!.sku_code}`,
          manage_inventory: true,
          inventory_items: [{ inventory_item_id: blankIdBySku.get(skuFor(caseTypeSlug, deviceSlug))!, required_quantity: 1 }],
          options: { [CASE_TYPE_OPTION]: ctName, [DEVICE_OPTION]: devName },
          prices: [{ amount: priceFor(remapCt(caseTypeSeedBySlug.get(caseTypeSlug)!, form).slug, deviceSlug), currency_code: CURRENCY }],
          metadata: { images, device_slug: deviceSlug, case_type_slug: remapCt(caseTypeSeedBySlug.get(caseTypeSlug)!, form).slug },
        })),
      },
    })
    variantsAdded += toCreate.length

    // Extend the product gallery with the new images (versioned URLs already).
    const existingUrls = new Set<string>((product.images ?? []).map((i: any) => i.url))
    const addUrls = [...new Set(toCreate.flatMap((t) => t.images))].filter((u) => !existingUrls.has(u))
    if (addUrls.length) {
      await productModule.updateProducts(product.id, {
        images: [...(product.images ?? []).map((i: any) => ({ url: i.url })), ...addUrls.map((url) => ({ url }))],
      })
    }
    touchedProductIds.push(product.id)
  }

  if (touchedProductIds.length) {
    await rebuildCards(container, { productIds: touchedProductIds })
  }
  return { ok: true, variantsAdded, skipped, skippedForms: [...skippedForms] }
}
