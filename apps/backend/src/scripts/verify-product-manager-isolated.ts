import assert from "node:assert/strict"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createSalesChannelsWorkflow, linkSalesChannelsToStockLocationWorkflow, createCartWorkflow } from "@medusajs/medusa/core-flows"
import { createRegularProductWorkflow, addRegularVariantWorkflow, saveManagedVariantsWorkflow } from "../workflows/product-manager"
import { createUploadedDesign } from "../lib/create-uploaded-design"
import { addPairsToDesign } from "../lib/add-design-pairs"
import { getDesignDetail, listLiveDesigns } from "../lib/design-admin"
import { editDesignMeta } from "../lib/edit-design"
import { CATALOG_MODULE } from "../modules/catalog"

/** Runs after the checkout fixture, on its disposable database only. */
export default async function verifyProductManager({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid")
  if (process.env.PRODUCT_MANAGER_ISOLATED_TEST !== "1" || !/^\/florayn_checkout_test_[a-z0-9_]+$/.test(database.pathname) || !["localhost", "127.0.0.1"].includes(database.hostname) || process.env.REVALIDATE_SECRET || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.STOREFRONT_URL ?? "")) throw new Error("Product Manager tests require the disposable local checkout fixture.")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { result: channels } = await createSalesChannelsWorkflow(container).run({ input: { salesChannelsData: [{ name: "Florayn Web" }] } })
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"] })
  assert.ok(locations[0])
  await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: locations[0].id, add: [channels[0].id] } })
  const input = {
    name: "Manager fixture", slug: "manager-fixture", description: "Synthetic regular product", status: "draft",
    options: [{ title: "Color", values: ["Black"] }, { title: "Size", values: ["S", "L"] }],
    variants: [
      { sku: "MANAGER-B-S", price: 425.5, stock: 0, images: ["https://example.invalid/black-s.webp"], options: { Color: "Black", Size: "S" } },
      { sku: "MANAGER-B-L", price: 525, stock: 8, images: ["https://example.invalid/black-l.webp"], options: { Color: "Black", Size: "L" } },
    ],
  }
  const { result } = await createRegularProductWorkflow(container).run({ input })
  let detail = await getDesignDetail(container, result.slug!)
  assert.ok(detail)
  assert.equal(detail.kind, "regular")
  const original = detail.products[0]
  assert.equal(original.status, "draft")
  const small = original.variants.find((v) => v.sku === "MANAGER-B-S")!
  const large = original.variants.find((v) => v.sku === "MANAGER-B-L")!
  assert.equal(small.price, 425.5)
  assert.equal(small.inventory[0].levels[0].stocked, 0)
  assert.equal(large.inventory[0].levels[0].stocked, 8)
  await saveManagedVariantsWorkflow(container).run({ input: { productId: original.id, variants: [{ id: small.id, price: 450.5, images: ["https://example.invalid/replaced-version.webp"] }] } })
  detail = (await getDesignDetail(container, result.slug!))!
  assert.equal(detail.products[0].variants.find((v) => v.id === small.id)?.price, 450.5)
  assert.equal(detail.products[0].thumbnail, "https://example.invalid/replaced-version.webp")
  assert.equal(detail.products[0].variants.find((v) => v.id === large.id)?.price, 525)
  await addRegularVariantWorkflow(container).run({ input: { productId: original.id, variant: { sku: "MANAGER-W-L", options: { Color: "White", Size: "L" }, price: 575, stock: 9, images: ["https://example.invalid/white-l.webp"] } } })
  detail = (await getDesignDetail(container, result.slug!))!
  assert.equal(detail.products[0].variants.length, 3)
  assert.ok(detail.products[0].variants.some((v) => v.id === small.id))
  assert.equal(detail.products[0].variants.find((v) => v.sku === "MANAGER-W-L")?.inventory[0].levels[0].stocked, 9)
  await editDesignMeta(container, result.slug!, { name: "Manager edited", description: "Edited description", theme: "Fixture collection", status: "published" })
  await editDesignMeta(container, result.slug!, { theme: "" })
  detail = (await getDesignDetail(container, result.slug!))!
  assert.equal(detail.collection, null)
  assert.equal(detail.products[0].description, "Edited description")
  const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
  const { result: cart } = await createCartWorkflow(container).run({ input: { region_id: regions[0].id, sales_channel_id: channels[0].id, items: [{ variant_id: large.id, quantity: 1 }] } })
  assert.equal(cart.items?.[0].variant_id, large.id)
  assert.equal(Number(cart.items?.[0].unit_price), 525)

  const catalog: any = container.resolve(CATALOG_MODULE)
  await catalog.createCaseTypes([{ slug: "manager-shell", name: "Manager Shell", sku_code: "MGS", price: 1450, sort_order: 99 }])
  await catalog.createDevices([
    { slug: "manager-model-one", name: "Manager Model One", family: "iphone", brand: "Fixture", sku_code: "MG1", sort_order: 99, is_active: true },
    { slug: "manager-model-two", name: "Manager Model Two", family: "iphone", brand: "Fixture", sku_code: "MG2", sort_order: 100, is_active: true },
    { slug: "manager-earbuds", name: "Manager Earbuds", family: "airpods", brand: "Fixture", sku_code: "MGE", sort_order: 101, is_active: true },
  ])
  const created = await createUploadedDesign({ container, name: "One pair fixture", slug: "manager-one-pair", status: "draft", blankStock: 7, pairs: { "manager-shell": { "manager-model-one": ["https://example.invalid/design-one.webp"] } } })
  assert.equal(created.variants, 1)
  let design = (await getDesignDetail(container, "manager-one-pair"))!
  const firstVariant = design.products[0].variants[0]
  assert.equal(firstVariant.price, 1450)
  assert.equal(firstVariant.inventory[0].levels[0].stocked, 7)
  await addPairsToDesign(container, "manager-one-pair", { "manager-shell": { "manager-model-two": ["https://example.invalid/design-two.webp"] } }, 0)
  design = (await getDesignDetail(container, "manager-one-pair"))!
  assert.equal(design.products[0].variants.length, 2)
  assert.ok(design.products[0].variants.some((v) => v.id === firstVariant.id))
  const duplicate = await createUploadedDesign({ container, name: "Duplicate fixture", slug: "manager-duplicate", status: "draft", blankStock: 99, pairs: { "manager-shell": { "manager-model-one": ["https://example.invalid/design-one.webp"] } } })
  const copied = (await getDesignDetail(container, duplicate.design))!
  assert.equal(copied.products[0].variants[0].inventory[0].id, firstVariant.inventory[0].id)
  assert.equal(copied.products[0].variants[0].inventory[0].levels[0].stocked, 7, "Duplicate must not add 99 to shared stock")
  await addPairsToDesign(container, "manager-one-pair", { "manager-shell": { "manager-earbuds": ["https://example.invalid/earbuds.webp"] } }, 0)
  design = (await getDesignDetail(container, "manager-one-pair"))!
  assert.equal(design.products.length, 2, "A missing product form can be added later")
  assert.ok(design.products.find((p) => p.form === "phone")?.variants.some((v) => v.id === firstVariant.id))
  let rejected = false
  try { await saveManagedVariantsWorkflow(container).run({ input: { productId: design.products.find((p) => p.form === "phone")!.id, variants: [{ id: firstVariant.id, price: 1 }] } }) } catch { rejected = true }
  assert.ok(rejected, "Case-type pricing must reject per-design override")
  const list = await listLiveDesigns(container, true)
  assert.ok(list.some((row) => row.slug === result.slug && row.kind === "regular"))
  assert.ok(list.some((row) => row.slug === "manager-one-pair" && row.variantCount === 3))
  container.resolve(ContainerRegistrationKeys.LOGGER).info("PRODUCT_MANAGER_INTEGRATION_PASS: regular create/edit/append, exact cart variant and price, draft, single phone pair, dynamic catalogs, missing forms, stable IDs and shared-stock duplicate")
}
