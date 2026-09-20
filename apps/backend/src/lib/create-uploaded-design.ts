import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createCollectionsWorkflow,
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../modules/catalog"
import { CASE_TYPES } from "../modules/catalog/data/case-types"
import { DEVICES, type DeviceFamily } from "../modules/catalog/data/devices"
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

/** design slug -> case type slug -> device slug -> image URLs (already on R2). */
export type UploadedPairs = Record<string, Record<string, string[]>>

export type CreateUploadedDesignResult = {
  design: string
  products: { id: string; handle: string; title: string }[]
  variants: number
  blanksCreated: number
  images: number
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** A stable, collision-safe SKU stem from the design slug (letters + digits). */
export function skuCodeFromSlug(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/**
 * Build the Structure-B product(s) for a BRAND-NEW design the owner uploaded -
 * one that is not in the static catalogue data. The design's shape (which case
 * types, which devices) and its images both come from the uploaded folders,
 * passed in as `pairs`, rather than from designs.ts / the manifest.
 *
 * Everything else mirrors create-design-products.ts: one product per form, Case
 * Type + Device options, the sparse valid-variant matrix, each variant linked to
 * the SHARED blank pool for its (case type, device), prices from the admin case
 * types. The uploaded renders are written straight onto the variants and the
 * product gallery, so no manifest wiring pass is needed.
 */
export async function createUploadedDesign({
  container,
  name,
  slug: slugInput,
  theme,
  skuCode: skuCodeInput,
  blankStock = 10,
  pairs,
}: {
  container: any
  name: string
  slug?: string
  theme?: string | null
  skuCode?: string
  blankStock?: number
  pairs: UploadedPairs
}): Promise<CreateUploadedDesignResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productModule = container.resolve(Modules.PRODUCT)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const inventoryModule = container.resolve(Modules.INVENTORY)
  const catalog: any = container.resolve(CATALOG_MODULE)

  const cleanName = (name ?? "").trim()
  if (!cleanName) throw new Error("A design name is required.")
  const slug = (slugInput?.trim() ? slugify(slugInput) : slugify(cleanName))
  if (!slug) throw new Error("Could not derive a slug from the design name.")
  const skuCode = (skuCodeInput?.trim() || skuCodeFromSlug(slug)).toUpperCase()

  // --- Resolve seeds and normalise the uploaded pairs to known slugs ---
  const caseTypeSeedBySlug = new Map(CASE_TYPES.map((c) => [c.slug, c]))
  const deviceSeedBySlug = new Map(DEVICES.map((d) => [d.slug, d]))

  // pairs -> flat, validated list, dropping any pair with no images.
  const flat: { caseTypeSlug: string; deviceSlug: string; images: string[] }[] = []
  for (const [caseTypeSlug, devices] of Object.entries(pairs ?? {})) {
    if (!caseTypeSeedBySlug.has(caseTypeSlug)) {
      throw new Error(`Unknown case type "${caseTypeSlug}".`)
    }
    for (const [deviceSlug, urls] of Object.entries(devices ?? {})) {
      if (!deviceSeedBySlug.has(deviceSlug)) {
        throw new Error(`Unknown device "${deviceSlug}" under "${caseTypeSlug}".`)
      }
      const images = (urls ?? []).filter((u) => typeof u === "string" && u.length)
      if (images.length) flat.push({ caseTypeSlug, deviceSlug, images })
    }
  }
  if (!flat.length) {
    throw new Error("No images were provided for any case type / device.")
  }

  // Already live?
  const existing = await productModule.listProducts(
    { handle: slug },
    { select: ["id"] }
  )
  if (existing.length) {
    throw new Error(`A product with the handle "${slug}" already exists.`)
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
  const themeName = theme?.trim() || null
  if (themeName) {
    const handle = slugify(themeName)
    const { data: cols } = await query.graph({
      entity: "product_collection",
      fields: ["id", "handle"],
    })
    collectionId = cols.find((c: any) => c.handle === handle)?.id
    if (!collectionId) {
      const { result } = await createCollectionsWorkflow(container).run({
        input: { collections: [{ title: themeName, handle }] },
      })
      collectionId = result[0].id
    }
  }

  const heroImage = flat[0].images[0]

  // Design catalog record (create if missing).
  const existingDesigns = await catalog.listDesigns({ slug })
  const designRecord =
    existingDesigns[0] ??
    (
      await catalog.createDesigns([
        {
          slug,
          name: cleanName,
          description: null,
          theme: themeName,
          artist: null,
          sku_code: skuCode,
          sort_order: 0,
          hero_image_url: heroImage,
        },
      ])
    )[0]

  // --- Prices: DB case-type price (admin-editable) + seed Alcantara groups ---
  const dbCaseTypes = await catalog.listCaseTypes({})
  const dbPriceBySlug = new Map<string, number>(
    dbCaseTypes.map((c: any) => [c.slug, c.price])
  )
  const priceFor = (caseTypeSlug: string, deviceSlug: string): number => {
    const seed = caseTypeSeedBySlug.get(caseTypeSlug)
    const group = seed?.price_groups?.find((g) => g.devices.includes(deviceSlug))
    if (group) return group.price
    return dbPriceBySlug.get(caseTypeSlug) ?? seed?.price ?? 0
  }

  // --- Blanks: reuse existing (by SKU) or create for this design's pairs ---
  const skuFor = (caseTypeSlug: string, deviceSlug: string) =>
    `${caseTypeSeedBySlug.get(caseTypeSlug)!.sku_code}-${deviceSeedBySlug.get(deviceSlug)!.sku_code}`

  const wantedSkus = [...new Set(flat.map((p) => skuFor(p.caseTypeSlug, p.deviceSlug)))]
  const existingBlanks = await inventoryModule.listInventoryItems({
    sku: wantedSkus,
  })
  const blankIdBySku = new Map<string, string>(
    existingBlanks.map((b: any) => [b.sku, b.id])
  )

  const missing = flat.filter(
    (p) => !blankIdBySku.has(skuFor(p.caseTypeSlug, p.deviceSlug))
  )
  // A design's pairs are unique, but dedupe by SKU in case the same blank shows
  // up twice (it never should - one blank per case type x device).
  const missingBySku = new Map<string, { caseTypeSlug: string; deviceSlug: string }>()
  for (const p of missing) missingBySku.set(skuFor(p.caseTypeSlug, p.deviceSlug), p)

  let blanksCreated = 0
  if (missingBySku.size) {
    const { result: created } = await createInventoryItemsWorkflow(container).run({
      input: {
        items: [...missingBySku.values()].map(({ caseTypeSlug, deviceSlug }) => {
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
  // form -> case type slug -> device slug -> images (order preserved).
  const byForm = new Map<ProductForm, Map<string, Map<string, string[]>>>()
  for (const { caseTypeSlug, deviceSlug, images } of flat) {
    const device = deviceSeedBySlug.get(deviceSlug)!
    const form = FORM_BY_FAMILY[device.family]
    const ctMap = byForm.get(form) ?? new Map<string, Map<string, string[]>>()
    const devMap = ctMap.get(caseTypeSlug) ?? new Map<string, string[]>()
    devMap.set(deviceSlug, images)
    ctMap.set(caseTypeSlug, devMap)
    byForm.set(form, ctMap)
  }

  let imageCount = 0
  const productsInput: any[] = []
  for (const form of FORM_ORDER) {
    const ctMap = byForm.get(form)
    if (!ctMap) continue
    // Case types in the store's canonical order; devices in DEVICES order.
    const formCaseTypes = CASE_TYPES.filter((c) => ctMap.has(c.slug))
    const formDeviceSlugs = new Set<string>()
    for (const devMap of ctMap.values()) for (const d of devMap.keys()) formDeviceSlugs.add(d)
    const formDevices = DEVICES.filter((d) => formDeviceSlugs.has(d.slug))
    const formFamilies = [...new Set(formDevices.map((d) => d.family))]
    const suffix = FORM_SUFFIX[form]
    const handle = suffix ? `${slug}-${suffix}` : slug

    const variants: any[] = []
    const galleryUrls: string[] = []
    for (const caseType of formCaseTypes) {
      const devMap = ctMap.get(caseType.slug)!
      for (const device of formDevices) {
        const images = devMap.get(device.slug)
        if (!images?.length) continue
        galleryUrls.push(...images)
        imageCount += images.length
        variants.push({
          title: `${caseType.name} / ${device.name}`,
          sku: `${skuCode}-${caseType.sku_code}-${device.sku_code}`,
          manage_inventory: true,
          inventory_items: [
            {
              inventory_item_id: blankIdBySku.get(skuFor(caseType.slug, device.slug))!,
              required_quantity: 1,
            },
          ],
          options: { "Case Type": caseType.name, Device: device.name },
          prices: [
            { amount: priceFor(caseType.slug, device.slug), currency_code: CURRENCY },
          ],
          metadata: {
            images,
            device_slug: device.slug,
            case_type_slug: caseType.slug,
          },
        })
      }
    }

    const gallery = [...new Set(galleryUrls)]

    productsInput.push({
      title: form === "phone" ? cleanName : `${cleanName} - ${FORM_LABEL[form]}`,
      handle,
      ...(form === "phone" ? {} : { subtitle: FORM_LABEL[form] }),
      status: ProductStatus.PUBLISHED,
      ...(shippingProfileId ? { shipping_profile_id: shippingProfileId } : {}),
      ...(collectionId ? { collection_id: collectionId } : {}),
      category_ids: [
        ...formCaseTypes.map((c) => categoryByHandle.get(c.slug)).filter(Boolean),
        ...formFamilies
          .map((family) => categoryByHandle.get(FAMILY_SLUGS[family]))
          .filter(Boolean),
      ],
      images: gallery.map((url) => ({ url })),
      thumbnail: gallery[0],
      metadata: {
        design_slug: slug,
        design_name: cleanName,
        form,
        case_type_slugs: formCaseTypes.map((caseType) => caseType.slug),
        image_granularity: "device",
        ...(themeName ? { theme: themeName } : {}),
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

  // Successful publication includes the card used by shop/related sections.
  // Do not depend on an in-memory event batch surviving a worker restart.
  await rebuildCards(container, { productIds: created.map((product: any) => product.id) })

  return {
    design: slug,
    products: created.map((p: any) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
    })),
    variants: variantCount,
    blanksCreated,
    images: imageCount,
  }
}
