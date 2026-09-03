import { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../modules/catalog"
import {
  SHIPPING,
  SHIPPING_OPTION_NAMES,
} from "../modules/catalog/data/bangladesh"
import { CASE_TYPES, priceForDevice } from "../modules/catalog/data/case-types"
import {
  CASE_TYPE_DEVICES,
  DEVICE_SETS,
  devicesFor,
} from "../modules/catalog/data/design-devices"
import { DESIGNS } from "../modules/catalog/data/designs"
import { DEVICES, type DeviceFamily } from "../modules/catalog/data/devices"
import { placeholderImage } from "../modules/catalog/data/placeholder-image"

const CURRENCY = "bdt"
const COUNTRY = "bd"

const FAMILY_LABELS: Record<DeviceFamily, string> = {
  iphone: "iPhone Cases",
  samsung: "Samsung Cases",
  airpods: "AirPods Cases",
  watch: "Watch Bands",
  wallet: "Card Wallets",
}

const FAMILY_SLUGS: Record<DeviceFamily, string> = {
  iphone: "iphone-cases",
  samsung: "samsung-cases",
  airpods: "airpods-cases",
  watch: "watch-bands",
  wallet: "card-wallets",
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export default async function initialDataSeed({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)
  const catalogModuleService: any = container.resolve(CATALOG_MODULE)

  const existingDesigns = await catalogModuleService.listDesigns({})
  if (existingDesigns.length) {
    logger.warn(
      "The catalog is already seeded. Drop and recreate the database before reseeding."
    )
    return
  }

  // An exclusion naming a device that no longer exists filters nothing, so a
  // renamed or dropped device would silently widen a case type's fit list.
  // Fail loudly instead.
  const deviceSlugs = new Set(DEVICES.map((device) => device.slug))
  const unknownDevices = [
    ...Object.entries(DEVICE_SETS).flatMap(([id, list]) =>
      list
        .filter((slug) => !deviceSlugs.has(slug))
        .map((slug) => `set ${id} -> ${slug}`)
    ),
    ...CASE_TYPES.flatMap((caseType) =>
      (caseType.price_groups ?? []).flatMap((group) =>
        group.devices
          .filter((slug) => !deviceSlugs.has(slug))
          .map((slug) => `${caseType.slug} price group "${group.label}" -> ${slug}`)
      )
    ),
  ]
  if (unknownDevices.length) {
    throw new Error(
      `devices referenced that are not in devices.ts: ${unknownDevices.join(", ")}`
    )
  }

  const designCaseTypes = new Set(DESIGNS.flatMap((d) => d.case_types))
  const knownCaseTypes = new Set(CASE_TYPES.map((c) => c.slug))
  const unknownCaseTypes = [...designCaseTypes].filter(
    (slug) => !knownCaseTypes.has(slug)
  )
  if (unknownCaseTypes.length) {
    throw new Error(
      `designs.ts references unknown case types: ${unknownCaseTypes.join(", ")}`
    )
  }

  logger.info("Seeding store, sales channel and API key...")
  const {
    result: [defaultSalesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        { name: "Florayn Web", description: "Florayn storefront" },
      ],
    },
  })

  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          title: "Florayn Storefront",
          type: "publishable",
          created_by: "seed",
        },
      ],
    },
  })

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableApiKey.id, add: [defaultSalesChannel.id] },
  })

  await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: "Florayn",
          supported_currencies: [{ currency_code: CURRENCY, is_default: true }],
          default_sales_channel_id: defaultSalesChannel.id,
        },
      ],
    },
  })

  logger.info("Seeding region and tax region...")
  const {
    result: [region],
  } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Bangladesh",
          currency_code: CURRENCY,
          countries: [COUNTRY],
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  })

  await createTaxRegionsWorkflow(container).run({
    input: [{ country_code: COUNTRY, provider_id: "tp_system" }],
  })

  logger.info("Seeding stock location and fulfillment...")
  const {
    result: [stockLocation],
  } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: "Dhaka Warehouse",
          address: { city: "Dhaka", country_code: "BD", address_1: "" },
        },
      ],
    },
  })

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  })

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  const shippingProfile = shippingProfiles[0]

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Dhaka Warehouse delivery",
    type: "shipping",
    service_zones: [
      {
        name: "Bangladesh",
        geo_zones: [{ country_code: COUNTRY, type: "country" }],
      },
    ],
  })

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  })

  // One option per zone, at the live florayn.com rates. Shipping is chosen
  // server-side at checkout from the district, so the customer never picks
  // a price. There is no free-delivery threshold on the live site.
  const shippingOptionInput = (
    name: string,
    code: string,
    description: string,
    amount: number
  ) => ({
    name,
    price_type: "flat" as const,
    provider_id: "manual_manual",
    service_zone_id: fulfillmentSet.service_zones[0].id,
    shipping_profile_id: shippingProfile.id,
    type: { label: name, description, code },
    prices: [
      { currency_code: CURRENCY, amount },
      { region_id: region.id, amount },
    ],
    rules: [
      // `as const` keeps these as the literal "eq" rather than widening to
      // string, which is what CreateFlatRateShippingOptionInput's
      // RuleOperatorType requires - same reason price_type is pinned above.
      { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
      { attribute: "is_return", value: "false", operator: "eq" as const },
    ],
  })

  await createShippingOptionsWorkflow(container).run({
    input: [
      shippingOptionInput(
        SHIPPING_OPTION_NAMES["inside-dhaka"],
        "inside-dhaka",
        "Delivered in 1-2 days.",
        SHIPPING.insideDhaka
      ),
      shippingOptionInput(
        SHIPPING_OPTION_NAMES["outside-dhaka"],
        "outside-dhaka",
        "Delivered in 3-5 days.",
        SHIPPING.outsideDhaka
      ),
    ],
  })

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [defaultSalesChannel.id] },
  })

  logger.info(`Seeding catalog: ${DEVICES.length} devices...`)
  const devices = await catalogModuleService.createDevices(
    DEVICES.map((device, index) => ({ ...device, sort_order: index }))
  )
  const deviceBySlug = new Map<string, any>(
    devices.map((device: any) => [device.slug, device])
  )

  logger.info(`Seeding catalog: ${CASE_TYPES.length} case types...`)
  const caseTypes = await catalogModuleService.createCaseTypes(
    CASE_TYPES.map((caseType, index) => {
      const union = new Set(CASE_TYPE_DEVICES[caseType.slug] ?? [])
      return {
        slug: caseType.slug,
        name: caseType.name,
        description: caseType.description,
        sku_code: caseType.sku_code,
        price: caseType.price,
        sort_order: index,
        devices: DEVICES.filter((device) => union.has(device.slug)).map(
          (device) => deviceBySlug.get(device.slug)!.id
        ),
      }
    })
  )
  const caseTypeBySlug = new Map<string, any>(
    caseTypes.map((caseType: any) => [caseType.slug, caseType])
  )

  logger.info(`Seeding catalog: ${DESIGNS.length} designs...`)
  const designs = await catalogModuleService.createDesigns(
    DESIGNS.map((design, index) => ({
      slug: design.slug,
      name: design.name,
      description: null,
      theme: design.theme,
      artist: null,
      sku_code: design.sku_code,
      sort_order: index,
      hero_image_url: placeholderImage(design.slug, design.name),
    }))
  )
  const designBySlug = new Map<string, any>(
    designs.map((design: any) => [design.slug, design])
  )

  logger.info("Seeding categories and collections...")
  const { result: categories } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        ...CASE_TYPES.map((caseType) => ({
          name: caseType.name,
          handle: caseType.slug,
          description: caseType.description,
          is_active: true,
        })),
        ...(Object.keys(FAMILY_LABELS) as DeviceFamily[]).map((family) => ({
          name: FAMILY_LABELS[family],
          handle: FAMILY_SLUGS[family],
          is_active: true,
        })),
      ],
    },
  })
  const categoryByHandle = new Map<string, any>(
    categories.map((category: any) => [category.handle, category])
  )

  // 60 of the 181 designs are filed under no collection on the live site, so
  // only the real collection names become Medusa collections.
  const themes = [
    ...new Set(
      DESIGNS.map((design) => design.theme).filter(
        (theme): theme is string => Boolean(theme)
      )
    ),
  ]
  const { result: collections } = await createCollectionsWorkflow(container).run(
    {
      input: {
        collections: themes.map((theme) => ({
          title: theme,
          handle: theme.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        })),
      },
    }
  )
  const collectionByTitle = new Map<string, any>(
    collections.map((collection: any) => [collection.title, collection])
  )

  logger.info("Seeding products (one per design x case type)...")
  let productCount = 0
  let variantCount = 0

  for (const design of DESIGNS) {
    const designRecord = designBySlug.get(design.slug)!
    const caseTypeIds: string[] = []

    const productsInput = design.case_types.map((caseTypeSlug) => {
      const caseTypeSeed = CASE_TYPES.find((c) => c.slug === caseTypeSlug)!
      // Which devices this design is actually sold for in this construction,
      // read from the live catalogue rather than derived from the case type.
      const sold = new Set(devicesFor(design.slug, caseTypeSlug))
      const compatible = DEVICES.filter((device) => sold.has(device.slug))
      // A product with no variants cannot be bought, so fail rather than
      // quietly publish one if the swept data ever loses a pair.
      if (!compatible.length) {
        throw new Error(
          `no devices for ${design.slug} in ${caseTypeSlug}; re-sweep design-devices.ts`
        )
      }
      const families = [...new Set(compatible.map((device) => device.family))]

      caseTypeIds.push(caseTypeBySlug.get(caseTypeSlug)!.id)
      variantCount += compatible.length

      return {
        title: `${design.name} - ${caseTypeSeed.name}`,
        // This handle is the /product/<slug>/ URL. Keep the shape stable.
        handle: `${design.slug}-${caseTypeSlug}`,
        subtitle: caseTypeSeed.name,
        description: caseTypeSeed.description,
        status: ProductStatus.PUBLISHED,
        shipping_profile_id: shippingProfile.id,
        ...(design.theme
          ? { collection_id: collectionByTitle.get(design.theme)!.id }
          : {}),
        category_ids: [
          categoryByHandle.get(caseTypeSlug)!.id,
          ...families.map(
            (family) => categoryByHandle.get(FAMILY_SLUGS[family])!.id
          ),
        ],
        images: [1, 2, 3].map((n) => ({
          url: placeholderImage(`${design.slug}-${caseTypeSlug}-${n}`, design.name),
        })),
        // Mirrored onto the product so the Store API can render a card without
        // a second round trip for the linked design and case type.
        metadata: {
          design_slug: design.slug,
          design_name: design.name,
          case_type_slug: caseTypeSlug,
          case_type_name: caseTypeSeed.name,
          ...(design.theme ? { theme: design.theme } : {}),
        },
        options: [
          {
            title: "Device",
            values: compatible.map((device) => device.name),
          },
        ],
        variants: compatible.map((device) => ({
          title: device.name,
          sku: `${design.sku_code}-${caseTypeSeed.sku_code}-${device.sku_code}`,
          manage_inventory: true,
          options: { Device: device.name },
          prices: [
            {
              // Flat for five constructions; Alcantara varies by device group.
              amount: priceForDevice(caseTypeSeed, device.slug),
              currency_code: CURRENCY,
            },
          ],
        })),
        sales_channels: [{ id: defaultSalesChannel.id }],
      }
    })

    const { result: created } = await createProductsWorkflow(container).run({
      input: { products: productsInput },
    })

    for (let i = 0; i < created.length; i++) {
      await link.create([
        {
          [Modules.PRODUCT]: { product_id: created[i].id },
          [CATALOG_MODULE]: { design_id: designRecord.id },
        },
        {
          [Modules.PRODUCT]: { product_id: created[i].id },
          [CATALOG_MODULE]: { case_type_id: caseTypeIds[i] },
        },
      ])
    }

    productCount += created.length
    logger.info(`  ${design.name}: ${created.length} products`)
  }

  logger.info("Seeding inventory levels...")
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  })

  for (const batch of chunk(inventoryItems, 200)) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: batch.map((item: any) => ({
          location_id: stockLocation.id,
          inventory_item_id: item.id,
          stocked_quantity: 100,
        })),
      },
    })
  }

  logger.info(
    `Done. ${DESIGNS.length} designs, ${CASE_TYPES.length} case types, ` +
      `${DEVICES.length} devices, ${productCount} products, ${variantCount} variants.`
  )
  logger.info(
    `Publishable API key for the storefront: ${publishableApiKey.token}`
  )
}
