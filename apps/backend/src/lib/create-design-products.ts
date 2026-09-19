import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createCollectionsWorkflow,
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../modules/catalog"
import { CASE_TYPES } from "../modules/catalog/data/case-types"
import { devicesFor } from "../modules/catalog/data/design-devices"
import { DESIGNS } from "../modules/catalog/data/designs"
import { DEVICES, type DeviceFamily } from "../modules/catalog/data/devices"
import { placeholderImage } from "../modules/catalog/data/placeholder-image"
import { rebuildCards } from "./rebuild-cards"
import { wireImagesDevice } from "./wire-images-device"

const CURRENCY = "bdt"

type ProductForm = "phone" | "airpods" | "watch" | "wallet"
const FORM_BY_FAMILY: Record<DeviceFamily, ProductForm> = {
  iphone: "phone",
  samsung: "phone",
  airpods: "airpods",
  watch: "watch",
  wallet: "wallet",
}
const FORM_LABEL: Record<ProductForm, string> = {
  phone: "Phone Case",
  airpods: "AirPods Case",
  watch: "Watch Band",
  wallet: "Card Wallet",
}
const FORM_SUFFIX: Record<ProductForm, string> = {
  phone: "",
  airpods: "airpods",
  watch: "watch",
  wallet: "wallet",
}
const FORM_ORDER: ProductForm[] = ["phone", "airpods", "watch", "wallet"]

const FAMILY_SLUGS: Record<DeviceFamily, string> = {
  iphone: "iphone-cases",
  samsung: "samsung-cases",
  airpods: "airpods-cases",
  watch: "watch-bands",
  wallet: "card-wallets",
}

export type CreateDesignResult = {
  design: string
  products: { id: string; handle: string; title: string }[]
  variants: number
  blanksCreated: number
  imagesWired: number
}

/**
 * Build the full Structure-B product(s) for ONE design at runtime - the engine
 * behind the "New Design" admin tool and per-design import. Mirrors the seed's
 * per-design logic, but looks up the store's existing infrastructure instead of
 * creating it: one product per form (phone / airpods / ...), Case Type + Device
 * options, the sparse valid-variant matrix, each variant linked to the SHARED
 * blank pool for its (case type, device), and images wired from the manifest.
 */
export async function createDesignProducts({
  container,
  designSlug,
  blankStock = 10,
}: {
  container: any
  designSlug: string
  blankStock?: number
}): Promise<CreateDesignResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productModule = container.resolve(Modules.PRODUCT)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const inventoryModule = container.resolve(Modules.INVENTORY)
  const catalog: any = container.resolve(CATALOG_MODULE)

  const design = DESIGNS.find((d) => d.slug === designSlug)
  if (!design) {
    throw new Error(`Unknown design "${designSlug}" (not in designs.ts).`)
  }

  // Already live?
  const existing = await productModule.listProducts(
    { handle: design.slug },
    { select: ["id"] }
  )
  if (existing.length) {
    throw new Error(`"${design.name}" is already in the store.`)
  }

  // --- Look up existing store infrastructure ---
  const [channel] = await salesChannelModule.listSalesChannels({
    name: "Florayn Web",
  })
  if (!channel) throw new Error("Sales channel 'Florayn Web' not found.")

  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id"],
  })
  const stockLocationId = locations[0]?.id
  if (!stockLocationId) throw new Error("No stock location found.")

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  const shippingProfileId = profiles[0]?.id

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle"],
  })
  const categoryByHandle = new Map<string, string>(
    categories.map((c: any) => [c.handle, c.id])
  )

  // Collection for the design's theme (create if missing).
  let collectionId: string | undefined
  if (design.theme) {
    const handle = design.theme.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    const { data: cols } = await query.graph({
      entity: "product_collection",
      fields: ["id", "handle"],
    })
    collectionId = cols.find((c: any) => c.handle === handle)?.id
    if (!collectionId) {
      const { result } = await createCollectionsWorkflow(container).run({
        input: { collections: [{ title: design.theme, handle }] },
      })
      collectionId = result[0].id
    }
  }

  // Design catalog record (create if missing).
  const existingDesigns = await catalog.listDesigns({ slug: design.slug })
  const designRecord =
    existingDesigns[0] ??
    (
      await catalog.createDesigns([
        {
          slug: design.slug,
          name: design.name,
          description: null,
          theme: design.theme,
          artist: null,
          sku_code: design.sku_code,
          sort_order: 0,
          hero_image_url: placeholderImage(design.slug, design.name),
        },
      ])
    )[0]

  // --- Prices: DB case-type price (admin-editable) + seed Alcantara groups ---
  const dbCaseTypes = await catalog.listCaseTypes({})
  const dbPriceBySlug = new Map<string, number>(
    dbCaseTypes.map((c: any) => [c.slug, c.price])
  )
  const caseTypeSeedBySlug = new Map(CASE_TYPES.map((c) => [c.slug, c]))
  const deviceSeedBySlug = new Map(DEVICES.map((d) => [d.slug, d]))
  const priceFor = (caseTypeSlug: string, deviceSlug: string): number => {
    const seed = caseTypeSeedBySlug.get(caseTypeSlug)
    const group = seed?.price_groups?.find((g) => g.devices.includes(deviceSlug))
    if (group) return group.price
    return dbPriceBySlug.get(caseTypeSlug) ?? seed?.price ?? 0
  }

  // --- Blanks: reuse existing (by SKU) or create for this design's pairs ---
  const pairs = new Map<string, { caseTypeSlug: string; deviceSlug: string }>()
  for (const caseTypeSlug of design.case_types) {
    for (const deviceSlug of devicesFor(design.slug, caseTypeSlug)) {
      pairs.set(`${caseTypeSlug}|${deviceSlug}`, { caseTypeSlug, deviceSlug })
    }
  }
  if (!pairs.size) {
    throw new Error(`No sold devices for "${design.name}"; check design-devices.ts.`)
  }

  const skuFor = (caseTypeSlug: string, deviceSlug: string) =>
    `${caseTypeSeedBySlug.get(caseTypeSlug)!.sku_code}-${deviceSeedBySlug.get(deviceSlug)!.sku_code}`

  const wantedSkus = [...pairs.values()].map((p) =>
    skuFor(p.caseTypeSlug, p.deviceSlug)
  )
  const existingBlanks = await inventoryModule.listInventoryItems({
    sku: wantedSkus,
  })
  const blankIdBySku = new Map<string, string>(
    existingBlanks.map((b: any) => [b.sku, b.id])
  )

  const missing = [...pairs.values()].filter(
    (p) => !blankIdBySku.has(skuFor(p.caseTypeSlug, p.deviceSlug))
  )
  let blanksCreated = 0
  if (missing.length) {
    const { result: created } = await createInventoryItemsWorkflow(
      container
    ).run({
      input: {
        items: missing.map(({ caseTypeSlug, deviceSlug }) => {
          const ct = caseTypeSeedBySlug.get(caseTypeSlug)!
          const dev = deviceSeedBySlug.get(deviceSlug)!
          return {
            sku: skuFor(caseTypeSlug, deviceSlug),
            title: `${ct.name} - ${dev.name}`,
            metadata: {
              case_type_slug: caseTypeSlug,
              case_type_name: ct.name,
              device_slug: deviceSlug,
              device_name: dev.name,
              is_blank: true,
            },
          }
        }),
      },
    })
    for (const item of created as any[]) blankIdBySku.set(item.sku, item.id)
    blanksCreated = created.length
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: (created as any[]).map((item) => ({
          location_id: stockLocationId,
          inventory_item_id: item.id,
          stocked_quantity: blankStock,
        })),
      },
    })
  }

  // --- Group the design's pairs by form and build one product each ---
  const byForm = new Map<ProductForm, Map<string, typeof DEVICES>>()
  for (const caseTypeSlug of design.case_types) {
    for (const deviceSlug of devicesFor(design.slug, caseTypeSlug)) {
      const device = deviceSeedBySlug.get(deviceSlug)!
      const form = FORM_BY_FAMILY[device.family]
      const ctMap = byForm.get(form) ?? new Map()
      const list = (ctMap.get(caseTypeSlug) ?? []) as typeof DEVICES
      list.push(device)
      ctMap.set(caseTypeSlug, list)
      byForm.set(form, ctMap)
    }
  }

  const productsInput: any[] = []
  for (const form of FORM_ORDER) {
    const ctMap = byForm.get(form)
    if (!ctMap) continue
    const formCaseTypes = CASE_TYPES.filter((c) => ctMap.has(c.slug))
    const formDeviceSlugs = new Set<string>()
    for (const list of ctMap.values()) for (const d of list) formDeviceSlugs.add(d.slug)
    const formDevices = DEVICES.filter((d) => formDeviceSlugs.has(d.slug))
    const formFamilies = [...new Set(formDevices.map((d) => d.family))]
    const suffix = FORM_SUFFIX[form]
    const handle = suffix ? `${design.slug}-${suffix}` : design.slug

    const variants: any[] = []
    for (const caseType of formCaseTypes) {
      for (const device of ctMap.get(caseType.slug)!) {
        variants.push({
          title: `${caseType.name} / ${device.name}`,
          sku: `${design.sku_code}-${caseType.sku_code}-${device.sku_code}`,
          manage_inventory: true,
          inventory_items: [
            {
              inventory_item_id: blankIdBySku.get(
                skuFor(caseType.slug, device.slug)
              )!,
              required_quantity: 1,
            },
          ],
          options: { "Case Type": caseType.name, Device: device.name },
          prices: [{ amount: priceFor(caseType.slug, device.slug), currency_code: CURRENCY }],
        })
      }
    }

    productsInput.push({
      title: form === "phone" ? design.name : `${design.name} - ${FORM_LABEL[form]}`,
      handle,
      ...(form === "phone" ? {} : { subtitle: FORM_LABEL[form] }),
      status: ProductStatus.PUBLISHED,
      ...(shippingProfileId ? { shipping_profile_id: shippingProfileId } : {}),
      ...(collectionId ? { collection_id: collectionId } : {}),
      category_ids: [
        ...formCaseTypes
          .map((c) => categoryByHandle.get(c.slug))
          .filter(Boolean),
        ...formFamilies
          .map((family) => categoryByHandle.get(FAMILY_SLUGS[family]))
          .filter(Boolean),
      ],
      images: [1, 2, 3].map((n) => ({
        url: placeholderImage(`${handle}-${n}`, design.name),
      })),
      metadata: {
        design_slug: design.slug,
        design_name: design.name,
        form,
        ...(design.theme ? { theme: design.theme } : {}),
      },
      options: [
        { title: "Case Type", values: formCaseTypes.map((c) => c.name) },
        { title: "Device", values: formDevices.map((d) => d.name) },
      ],
      variants,
      sales_channels: [{ id: channel.id }],
    })
  }

  const variantCount = productsInput.reduce((n, p) => n + p.variants.length, 0)

  const { result: created } = await createProductsWorkflow(container).run({
    input: { products: productsInput },
  })
  for (const product of created) {
    await link.create({
      [Modules.PRODUCT]: { product_id: product.id },
      [CATALOG_MODULE]: { design_id: designRecord.id },
    })
  }

  // Wire this design's real renders onto its variants.
  const wire = await wireImagesDevice({
    container,
    productIds: created.map((p: any) => p.id),
  })

  // Precompute the card read-model for the new product(s) so the storefront
  // strips/listings can render them without hydrating variants.
  await rebuildCards(container, { productIds: created.map((p: any) => p.id) })

  return {
    design: design.slug,
    products: created.map((p: any) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
    })),
    variants: variantCount,
    blanksCreated,
    imagesWired: wire.urls,
  }
}
