import { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createInventoryItemsWorkflow,
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
import {
  DEVICES,
  type DeviceFamily,
  type DeviceSeed,
} from "../modules/catalog/data/devices"
import { placeholderImage } from "../modules/catalog/data/placeholder-image"

const CURRENCY = "bdt"
const COUNTRY = "bd"

/*
 * Default stock for each BLANK (a case type x device, e.g. "Signature x iPhone
 * 17 Pro Max"). Every design printed on that blank shares this one pool, so
 * when it runs out every design goes out of stock for that case type + device
 * at once - which is how print-on-demand-on-blanks actually works. The owner
 * sets real numbers per blank in the Stock admin screen; this is just the seed
 * starting point.
 */
const BLANK_STOCK = Number(process.env.SEED_BLANK_STOCK ?? 10)

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

  /*
   * SEED_THEME seeds only the designs of one collection - for a phased launch
   * that goes live with a single collection, gets the site and design right,
   * then loads the rest. Case types, devices, region and store are global and
   * still created in full; only the designs, their products and the collections
   * they belong to are narrowed. Unset seeds the whole catalogue.
   */
  const SEED_THEME = process.env.SEED_THEME?.trim()
  const seedDesigns = SEED_THEME
    ? DESIGNS.filter((d) => d.theme === SEED_THEME)
    : DESIGNS
  if (SEED_THEME) {
    if (!seedDesigns.length) {
      throw new Error(`SEED_THEME="${SEED_THEME}" matched no designs in designs.ts`)
    }
    logger.info(
      `SEED_THEME="${SEED_THEME}": seeding ${seedDesigns.length} of ${DESIGNS.length} designs`
    )
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

  /*
   * Reuse an existing sales channel and publishable key rather than making
   * new ones.
   *
   * The guard at the top of this script only checks for designs, so a
   * database that is partially seeded - designs missing, but a store and a
   * key already present - falls straight through to here. Creating
   * unconditionally then mints a SECOND publishable key with a new token, and
   * the storefront, which was built with the old one, starts getting
   * "A valid publishable key is required" against a catalogue that is
   * perfectly intact. That is not hypothetical: it is what put a rotated key
   * into production and an empty grid on the shop.
   *
   * db:migrate re-runs this script on every boot until it is recorded as
   * applied, so "creates something new each time it runs" is a rotation on a
   * timer.
   */
  const salesChannelService: any = container.resolve(Modules.SALES_CHANNEL)
  const apiKeyService: any = container.resolve(Modules.API_KEY)

  const existingChannels = await salesChannelService.listSalesChannels({
    name: "Florayn Web",
  })

  const defaultSalesChannel = existingChannels.length
    ? existingChannels[0]
    : (
        await createSalesChannelsWorkflow(container).run({
          input: {
            salesChannelsData: [
              { name: "Florayn Web", description: "Florayn storefront" },
            ],
          },
        })
      ).result[0]

  if (existingChannels.length) {
    logger.info(`Reusing sales channel ${defaultSalesChannel.id}.`)
  }

  const existingKeys = await apiKeyService.listApiKeys({ type: "publishable" })
  const liveKey = existingKeys.find((key: any) => !key.revoked_at)

  if (liveKey) {
    logger.info(
      `Reusing publishable key ${liveKey.id} - NOT minting a new one, so the ` +
        `token the storefront was built with keeps working.`
    )
  }

  const publishableApiKey = liveKey
    ? liveKey
    : (
        await createApiKeysWorkflow(container).run({
          input: {
            api_keys: [
              {
                title: "Florayn Storefront",
                type: "publishable",
                /*
                 * Empty, not "seed". The field is a user id - Medusa's own
                 * route stores req.auth_context.actor_id here - and the admin
                 * dashboard fetches /admin/users/<created_by> to show who made
                 * the key. A non-id string makes that detail page 404 with
                 * "User with id: seed was not found". No user exists yet at
                 * seed time, so the honest value is none. The type requires a
                 * string, hence "" rather than omitting it.
                 */
                created_by: "",
              },
            ],
          },
        })
      ).result[0]

  /*
   * Linking is attempted either way, because a previous run could have minted
   * the key and then failed before linking it - and an unlinked key is
   * rejected exactly like a missing one. Re-adding a link that already exists
   * is harmless but can throw on the duplicate, so that specific outcome is
   * tolerated and everything else is re-raised.
   */
  try {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: publishableApiKey.id, add: [defaultSalesChannel.id] },
    })
  } catch (error: any) {
    const message = error?.message ?? String(error)
    if (/already exist|duplicate/i.test(message)) {
      logger.info("Publishable key is already linked to the sales channel.")
    } else {
      throw error
    }
  }

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

  /*
   * Reused for the same reason as the key above. A country belongs to exactly
   * one region, so creating this a second time fails with `Countries with
   * codes: "bd" are already assigned to a region` - and that failure is what
   * used to end the run, leaving behind the freshly minted key it had just
   * created two steps earlier. The rotated key and the intact catalogue were
   * the same event.
   */
  const regionService: any = container.resolve(Modules.REGION)
  const existingRegions = await regionService.listRegions({ name: "Bangladesh" })

  const region = existingRegions.length
    ? existingRegions[0]
    : (
        await createRegionsWorkflow(container).run({
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
      ).result[0]

  if (existingRegions.length) {
    logger.info(`Reusing region ${region.id}.`)
  }

  // Same story: the country can only belong to one tax region.
  const taxService: any = container.resolve(Modules.TAX)
  const existingTaxRegions = await taxService.listTaxRegions({
    country_code: COUNTRY,
  })

  if (existingTaxRegions.length) {
    logger.info("Reusing tax region.")
  } else {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: COUNTRY, provider_id: "tp_system" }],
    })
  }

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
  await catalogModuleService.createCaseTypes(
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
  logger.info(`Seeding catalog: ${seedDesigns.length} designs...`)
  const designs = await catalogModuleService.createDesigns(
    seedDesigns.map((design, index) => ({
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
      seedDesigns.map((design) => design.theme).filter(
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

  /*
   * Blank inventory: one shared stock pool per (case type x device). Every
   * design's variant for that pair links to the SAME inventory item, so the
   * stock is shared across all designs - sell any design's "Signature x iPhone
   * 17 Pro Max" and every design's "Signature x iPhone 17 Pro Max" reflects it,
   * going out of stock together when the pool is empty.
   */
  logger.info("Seeding blank inventory (one shared pool per case type x device)...")
  const blankPairs = new Map<
    string,
    { caseTypeSlug: string; deviceSlug: string }
  >()
  for (const design of seedDesigns) {
    for (const caseTypeSlug of design.case_types) {
      for (const deviceSlug of devicesFor(design.slug, caseTypeSlug)) {
        blankPairs.set(`${caseTypeSlug}|${deviceSlug}`, {
          caseTypeSlug,
          deviceSlug,
        })
      }
    }
  }
  const caseTypeSeedBySlug = new Map(CASE_TYPES.map((c) => [c.slug, c]))
  const deviceSeedBySlug = new Map(DEVICES.map((d) => [d.slug, d]))
  const pairsArr = [...blankPairs.values()]
  const { result: blankItems } = await createInventoryItemsWorkflow(
    container
  ).run({
    input: {
      items: pairsArr.map(({ caseTypeSlug, deviceSlug }) => {
        const ct = caseTypeSeedBySlug.get(caseTypeSlug)!
        const dev = deviceSeedBySlug.get(deviceSlug)!
        return {
          sku: `${ct.sku_code}-${dev.sku_code}`,
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
  const blankIdBySku = new Map<string, string>(
    blankItems.map((item: any) => [item.sku, item.id])
  )
  const blankItemIdByPair = new Map<string, string>()
  for (const { caseTypeSlug, deviceSlug } of pairsArr) {
    const ct = caseTypeSeedBySlug.get(caseTypeSlug)!
    const dev = deviceSeedBySlug.get(deviceSlug)!
    blankItemIdByPair.set(
      `${caseTypeSlug}|${deviceSlug}`,
      blankIdBySku.get(`${ct.sku_code}-${dev.sku_code}`)!
    )
  }
  for (const batch of chunk(blankItems, 200)) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: batch.map((item: any) => ({
          location_id: stockLocation.id,
          inventory_item_id: item.id,
          stocked_quantity: BLANK_STOCK,
        })),
      },
    })
  }
  logger.info(`  ${blankItems.length} blanks (stock ${BLANK_STOCK} each).`)

  logger.info("Seeding products (one per design x product form)...")
  let productCount = 0
  let variantCount = 0

  /*
   * Structure B: a product is one design in one product FORM (phone case,
   * AirPods case, watch band, wallet) - NOT one design x case type. Case Type
   * and Device are the product's two options, and the variants are the
   * (case type, device) pairs that are actually sold: a sparse matrix, because
   * not every case type fits every device. Splitting by form is what keeps a
   * phone case listing only phones - an AirPods case is its own product under
   * the earbuds menu, never a "device" in the phone picker.
   */
  type ProductForm = "phone" | "airpods" | "watch" | "wallet"
  const FORM_BY_FAMILY: Record<DeviceFamily, ProductForm> = {
    iphone: "phone",
    samsung: "phone",
    airpods: "airpods",
    watch: "watch",
    wallet: "wallet",
  }
  // Storefront label + URL/handle suffix per form. Phone keeps the bare design
  // slug so the main product page stays /product/<design>.
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

  for (const design of seedDesigns) {
    const designRecord = designBySlug.get(design.slug)!

    // form -> caseTypeSlug -> the devices of that form sold in that case type.
    const byForm = new Map<ProductForm, Map<string, DeviceSeed[]>>()
    for (const caseTypeSlug of design.case_types) {
      const sold = new Set(devicesFor(design.slug, caseTypeSlug))
      const compatible = DEVICES.filter((device) => sold.has(device.slug))
      for (const device of compatible) {
        const form = FORM_BY_FAMILY[device.family]
        let ctMap = byForm.get(form)
        if (!ctMap) {
          ctMap = new Map()
          byForm.set(form, ctMap)
        }
        const list = ctMap.get(caseTypeSlug) ?? []
        list.push(device)
        ctMap.set(caseTypeSlug, list)
      }
    }
    // A design with no sold pair at all is a data error, not a silent skip.
    if (byForm.size === 0) {
      throw new Error(`no devices for ${design.slug}; re-sweep design-devices.ts`)
    }

    const productsInput: any[] = []

    for (const form of FORM_ORDER) {
      const ctMap = byForm.get(form)
      if (!ctMap) continue

      // Case types in this form, cheapest-first (CASE_TYPES order).
      const formCaseTypes = CASE_TYPES.filter((c) => ctMap.has(c.slug))
      // Devices in this form, union across its case types, in picker order.
      const formDeviceSlugs = new Set<string>()
      for (const list of ctMap.values()) {
        for (const device of list) formDeviceSlugs.add(device.slug)
      }
      const formDevices = DEVICES.filter((d) => formDeviceSlugs.has(d.slug))
      const formFamilies = [...new Set(formDevices.map((d) => d.family))]

      const suffix = FORM_SUFFIX[form]
      const handle = suffix ? `${design.slug}-${suffix}` : design.slug
      const title =
        form === "phone" ? design.name : `${design.name} - ${FORM_LABEL[form]}`

      // The sparse variant matrix: only the (case type, device) pairs sold.
      const variants: any[] = []
      for (const caseType of formCaseTypes) {
        for (const device of ctMap.get(caseType.slug)!) {
          variants.push({
            // Composite title, since a variant is now a (case type, device) pair.
            title: `${caseType.name} / ${device.name}`,
            sku: `${design.sku_code}-${caseType.sku_code}-${device.sku_code}`,
            manage_inventory: true,
            // Link to the SHARED blank pool for this case type x device, instead
            // of letting Medusa auto-create a private per-variant stock item.
            inventory_items: [
              {
                inventory_item_id: blankItemIdByPair.get(
                  `${caseType.slug}|${device.slug}`
                )!,
                required_quantity: 1,
              },
            ],
            options: { "Case Type": caseType.name, Device: device.name },
            prices: [
              {
                // Flat for five constructions; Alcantara varies by device group.
                amount: priceForDevice(caseType, device.slug),
                currency_code: CURRENCY,
              },
            ],
          })
        }
      }
      variantCount += variants.length

      productsInput.push({
        title,
        // handle is the /product/<slug>/ URL. Phone form = the bare design slug.
        handle,
        ...(form === "phone" ? {} : { subtitle: FORM_LABEL[form] }),
        status: ProductStatus.PUBLISHED,
        shipping_profile_id: shippingProfile.id,
        ...(design.theme
          ? { collection_id: collectionByTitle.get(design.theme)!.id }
          : {}),
        category_ids: [
          ...formCaseTypes.map((c) => categoryByHandle.get(c.slug)!.id),
          ...formFamilies.map(
            (family) => categoryByHandle.get(FAMILY_SLUGS[family])!.id
          ),
        ],
        images: [1, 2, 3].map((n) => ({
          url: placeholderImage(`${handle}-${n}`, design.name),
        })),
        // Mirrored so the Store API can render a card without extra joins. Case
        // type is now an OPTION, so it is intentionally not on the product.
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
        sales_channels: [{ id: defaultSalesChannel.id }],
      })
    }

    const { result: created } = await createProductsWorkflow(container).run({
      input: { products: productsInput },
    })

    // Case type is a variant OPTION now, not a product<->catalog link, so only
    // the design link is created. A product spans many case types, which the
    // one-to-many product<->case_type link could not represent anyway.
    for (const product of created) {
      await link.create({
        [Modules.PRODUCT]: { product_id: product.id },
        [CATALOG_MODULE]: { design_id: designRecord.id },
      })
    }

    productCount += created.length
    logger.info(`  ${design.name}: ${created.length} products`)
  }

  // Inventory levels are set on the shared blanks above; variants link to those
  // blanks rather than owning private stock, so there is nothing to level here.

  logger.info(
    `Done. ${seedDesigns.length} designs, ${CASE_TYPES.length} case types, ` +
      `${DEVICES.length} devices, ${productCount} products, ${variantCount} variants.`
  )
  logger.info(
    `Publishable API key for the storefront: ${publishableApiKey.token}`
  )
}
