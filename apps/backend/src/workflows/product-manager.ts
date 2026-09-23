import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { createProductsWorkflow, createProductVariantsWorkflow, createInventoryLevelsWorkflow, updateProductsWorkflow, updateProductVariantsWorkflow, updateProductOptionValuesOnProductStep } from "@medusajs/medusa/core-flows"
import { regularInput, imageUrls, money } from "../lib/product-manager-input"
import { rebuildCards } from "../lib/rebuild-cards"
import { isAudienceTag } from "../lib/audience"

const prepareRegular = createStep("prepare-regular-product", async (raw: Record<string, unknown>, { container }) => {
  const input = regularInput(raw)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [existing] = await container.resolve(Modules.PRODUCT).listProducts({ handle: input.slug }, { select: ["id"] })
  if (existing) throw new MedusaError(MedusaError.Types.INVALID_DATA, "That product URL already exists. Open the existing product to edit it.")
  const [channel] = await container.resolve(Modules.SALES_CHANNEL).listSalesChannels({ name: "Florayn Web" })
  const [{ data: locations }, { data: profiles }] = await Promise.all([
    query.graph({ entity: "stock_location", fields: ["id"] }),
    query.graph({ entity: "shipping_profile", fields: ["id", "type"] }),
  ])
  const profile = profiles.find((p: any) => p.type === "default")
  if (!channel || !locations[0] || !profile) throw new MedusaError(MedusaError.Types.INVALID_DATA, "A sales channel, warehouse and default shipping profile are required.")
  const images = [...new Set(input.variants.flatMap((v) => v.images))]
  return new StepResponse({
    input,
    locationId: locations[0].id,
    product: {
      title: input.name, handle: input.slug, description: input.description, status: input.status,
      shipping_profile_id: profile.id, sales_channels: [{ id: channel.id }],
      thumbnail: images[0] ?? null, images: images.map((url) => ({ url })),
      options: input.options,
      variants: input.variants.map((v) => ({
        title: v.title, sku: v.sku, manage_inventory: true, allow_backorder: false,
        options: v.options, prices: [{ amount: v.price, currency_code: "bdt" }], metadata: { images: v.images },
      })),
    },
  })
})

const regularStock = createStep("prepare-regular-stock", async (input: { productId: string; locationId: string; quantities: Record<string, number> }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "product", filters: { id: input.productId }, fields: ["id", "variants.sku", "variants.inventory_items.inventory_item_id"] })
  const levels = (data[0]?.variants ?? []).filter((v: any) => Object.prototype.hasOwnProperty.call(input.quantities, v.sku)).flatMap((v: any) => (v.inventory_items ?? []).map((link: any) => ({
    inventory_item_id: link.inventory_item_id, location_id: input.locationId, stocked_quantity: input.quantities[v.sku],
  })))
  if (levels.length !== Object.keys(input.quantities).length || levels.some((l: any) => !l.inventory_item_id || l.stocked_quantity === undefined)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The product inventory links could not be verified.")
  return new StepResponse(levels)
})

export const createRegularProductWorkflow = createWorkflow("create-regular-product", (input: Record<string, unknown>) => {
  const prepared = prepareRegular(input)
  const products = createProductsWorkflow.runAsStep({ input: { products: transform(prepared, (p) => [p.product]) } })
  const levels = regularStock(transform({ prepared, products }, ({ prepared, products }) => ({
    productId: products[0].id, locationId: prepared.locationId,
    quantities: Object.fromEntries(prepared.input.variants.map((v) => [v.sku, v.stock])),
  })))
  createInventoryLevelsWorkflow.runAsStep({ input: { inventory_levels: levels } })
  return new WorkflowResponse(transform(products, (rows) => ({ slug: rows[0].handle, id: rows[0].id })))
})

type VariantEdit = { productId: string; variants: { id: string; sku?: string; images?: string[]; price?: number; audience?: string }[] }
const prepareVariantEdit = createStep("prepare-manager-variant-edit", async (input: VariantEdit, { container }) => {
  if (!Array.isArray(input.variants) || !input.variants.length || input.variants.length > 200) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Select between 1 and 200 variants.")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "product", filters: { id: input.productId }, fields: [
    "id", "status", "metadata", "thumbnail", "images.url", "options.title", "variants.id", "variants.sku", "variants.metadata",
    "variants.prices.id", "variants.prices.amount", "variants.prices.currency_code", "variants.prices.price_list_id",
    "variants.prices.min_quantity", "variants.prices.max_quantity", "variants.prices.rules_count",
  ] })
  const product: any = data[0]
  if (!product) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found.")
  const caseProduct = product.options?.some((o: any) => o.title === "Case Type")
  const seen = new Set<string>()
  const variants = input.variants.map((patch) => {
    const variant = product.variants.find((v: any) => v.id === patch.id)
    if (!variant || seen.has(patch.id)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose unique variants belonging to this product.")
    seen.add(patch.id)
    const update: any = { id: variant.id }
    if (patch.sku !== undefined) {
      if (typeof patch.sku !== "string" || !patch.sku.trim() || patch.sku.length > 100) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Enter a SKU within 100 characters.")
      update.sku = patch.sku.trim()
    }
    if (patch.images !== undefined) {
      const images = imageUrls(patch.images)
      if (product.status === "published" && !images.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Keep at least one image for a published variant, or move the product to draft first.")
      update.metadata = { ...(variant.metadata ?? {}), images }
    }
    if (patch.audience !== undefined) {
      if (caseProduct) throw new MedusaError(MedusaError.Types.INVALID_DATA, "A case design is for Women, Men or both as a whole. Set it on the product, not per variant.")
      if (!isAudienceTag(patch.audience)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose Women, Men or Both.")
      update.metadata = { ...(update.metadata ?? variant.metadata ?? {}), audience: patch.audience }
    }
    if (patch.price !== undefined) {
      if (caseProduct) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Case products use the shared case-type price. Edit that price in Case Types.")
      const amount = money(patch.price)
      const prices = variant.prices ?? []
      if (prices.some((p: any) => !p.price_list_id && p.rules_count > 0)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "This variant has advanced price rules. Keep those rules when updating it through the standard pricing editor.")
      const base = prices.find((p: any) => p.currency_code === "bdt" && !p.price_list_id && p.min_quantity == null && p.max_quantity == null)
      update.prices = prices.filter((p: any) => !p.price_list_id).map((p: any) => ({ id: p.id, currency_code: p.currency_code, amount: p.id === base?.id ? amount : p.amount, min_quantity: p.min_quantity, max_quantity: p.max_quantity }))
      if (!base) update.prices.push({ currency_code: "bdt", amount })
    }
    return update
  })
  const byId = new Map(variants.map((v) => [v.id, v]))
  const skus = product.variants.map((v: any) => byId.get(v.id)?.sku ?? v.sku).filter(Boolean)
  if (new Set(skus).size !== skus.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, "SKUs must be unique.")
  const fallbackImages = caseProduct ? [] : (product.images ?? []).map((i: any) => i.url)
  const gallery = [...new Set<string>(product.variants.flatMap((v: any) => byId.get(v.id)?.metadata?.images ?? (v.metadata?.images?.length ? v.metadata.images : fallbackImages)))]
  const hasImages = input.variants.some((v) => v.images !== undefined)
  const coverVariant = product.variants.find((v: any) => v.metadata?.images?.[0] === product.thumbnail) ?? (!caseProduct && product.variants.length === 1 ? product.variants[0] : undefined)
  const replacedCover = coverVariant && byId.get(coverVariant.id)?.metadata?.images?.[0]
  return new StepResponse({ variants, productId: product.id, productUpdate: hasImages ? {
    id: product.id, images: gallery.map((url) => ({ url })), thumbnail: replacedCover ?? (gallery.includes(product.thumbnail) ? product.thumbnail : gallery[0] ?? null),
  } : { id: product.id } })
})

const repairManagerCards = createStep("repair-manager-cards", async (input: { productId: string; updated: unknown }, { container }) => {
  await rebuildCards(container, { productIds: [input.productId] })
  return new StepResponse({ ok: true })
})

export const saveManagedVariantsWorkflow = createWorkflow("save-managed-variants", (input: VariantEdit) => {
  const prepared = prepareVariantEdit(input)
  const variants = updateProductVariantsWorkflow.runAsStep({ input: { product_variants: prepared.variants } })
  const updated = updateProductsWorkflow.runAsStep({ input: { products: transform({ prepared, variants }, ({ prepared }) => [prepared.productUpdate]) } })
  const result = repairManagerCards({ productId: prepared.productId, updated })
  return new WorkflowResponse(result)
})

const prepareRegularVariant = createStep("prepare-regular-variant", async (input: { productId: string; variant: any }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "product", filters: { id: input.productId }, fields: ["id", "title", "handle", "status", "description", "images.url", "options.id", "options.title", "options.values.id", "options.values.value", "variants.options.option_id", "variants.options.value"] })
  const p: any = data[0]
  if (!p || p.options.some((o: any) => o.title === "Case Type")) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Use Add model / case type for a case product.")
  if (!input.variant?.options || p.options.some((o: any) => typeof input.variant.options[o.title] !== "string" || !input.variant.options[o.title].trim())) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose a value for every existing product option.")
  const options = p.options.map((o: any) => ({ title: o.title, values: [...new Set<string>([...o.values.map((v: any) => v.value), input.variant.options[o.title].trim()])] }))
  const parsed = regularInput({ name: p.title, slug: p.handle, description: p.description ?? "", status: p.status === "published" ? "published" : "draft", options, variants: [{ ...input.variant, options: Object.fromEntries(p.options.map((o: any) => [o.title, input.variant.options[o.title].trim()])) }] })
  const v = parsed.variants[0]
  if (p.variants.some((old: any) => p.options.every((o: any) => old.options.some((value: any) => value.option_id === o.id && value.value === v.options[o.title])))) throw new MedusaError(MedusaError.Types.INVALID_DATA, "This combination already exists. Edit that variant instead.")
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"] })
  if (!locations[0]) throw new MedusaError(MedusaError.Types.INVALID_DATA, "A warehouse is required.")
  const images = [...new Set<string>([...p.images.map((i: any) => i.url), ...v.images])]
  return new StepResponse({ productId: p.id, locationId: locations[0].id, stock: v.stock,
    optionUpdates: p.options.map((o: any) => ({ product_id: p.id, product_option_id: o.id, add: o.values.some((value: any) => value.value === v.options[o.title]) ? [] : [{ value: v.options[o.title] }] })),
    product: { id: p.id, images: images.map((url) => ({ url })) },
    variant: { product_id: p.id, title: v.title, sku: v.sku, manage_inventory: true, allow_backorder: false, options: v.options, metadata: { images: v.images }, prices: [{ currency_code: "bdt", amount: v.price }] },
  })
})

export const addRegularVariantWorkflow = createWorkflow("add-regular-variant", (input: { productId: string; variant: any }) => {
  const prepared = prepareRegularVariant(input)
  const optionValues = updateProductOptionValuesOnProductStep(prepared.optionUpdates)
  const product = updateProductsWorkflow.runAsStep({ input: { products: transform({ prepared, optionValues }, ({ prepared }) => [prepared.product]) } })
  const variants = createProductVariantsWorkflow.runAsStep({ input: { product_variants: transform({ prepared, product }, ({ prepared }) => [prepared.variant]) } })
  const levels = regularStock(transform({ prepared, variants }, ({ prepared }) => ({ productId: prepared.productId, locationId: prepared.locationId, quantities: { [prepared.variant.sku]: prepared.stock } })))
  const created = createInventoryLevelsWorkflow.runAsStep({ input: { inventory_levels: levels } })
  const result = repairManagerCards({ productId: prepared.productId, updated: created })
  return new WorkflowResponse(result)
})
