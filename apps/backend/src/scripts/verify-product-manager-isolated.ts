import { GET as getManual, POST as saveManual } from "../api/admin/products/[id]/recommendations/route"
import { POST as saveBadge } from "../api/admin/bundles/badge/route"
import { GET as publicBundles } from "../api/store/bundles/route"
import { MANUAL_RECOMMENDATIONS_KEY } from "../lib/manual-recommendations"
import { GET as getRecommendations, POST as saveRecommendations } from "../api/admin/content/recommendations/route"
import { GET as publicProductSections } from "../api/store/content/product-sections/route"
import { RECOMMENDATION_KEY } from "../lib/recommendation-settings"
import assert from "node:assert/strict"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createSalesChannelsWorkflow, linkSalesChannelsToStockLocationWorkflow, createCartWorkflow } from "@medusajs/medusa/core-flows"
import { createRegularProductWorkflow, addRegularVariantWorkflow, saveManagedVariantsWorkflow } from "../workflows/product-manager"
import { createUploadedDesign } from "../lib/create-uploaded-design"
import { addPairsToDesign } from "../lib/add-design-pairs"
import { getDesignDetail, listLiveDesigns } from "../lib/design-admin"
import { editDesignMeta } from "../lib/edit-design"
import { CATALOG_MODULE } from "../modules/catalog"
import { saveProductContentWorkflow } from "../workflows/save-product-content"
import { DEFAULT_PRODUCT_CONTENT, PRODUCT_CONTENT_KEY } from "../lib/product-content"
import { submitProductReviewWorkflow, moderateProductReviewWorkflow } from "../workflows/product-reviews"
import { publicReviews } from "../lib/product-reviews"
import { CONTENT_MODULE } from "../modules/content"
import { GET as getPresentation, POST as savePresentation } from "../api/admin/content/presentation/[section]/route"
import { GET as publicContent } from "../api/store/content/route"
import { DEFAULT_PRESENTATION, PRESENTATION_KEY } from "../lib/storefront-presentation"
import { POST as saveMockupSettings } from "../api/admin/mockups/route"
import { POST as saveDesignColours } from "../api/admin/designs/[slug]/colours/route"
import { DELETE as deleteDesign } from "../api/admin/designs/[slug]/route"
import { GET as storePhoneColours } from "../api/store/phone-colours/route"
import { GET as storeProductColours } from "../api/store/phone-colours/product/route"
import { GET as storeVariantColours } from "../api/store/phone-colours/variant/[id]/route"
import { GET as storeShopCards } from "../api/store/shop-cards/route"
import { expandTail } from "../lib/phone-colours"
import { restoreColourRows } from "../workflows/phone-colours"

/** Runs after the checkout fixture, on its disposable database only. */
export default async function verifyProductManager({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid")
  if (process.env.PRODUCT_MANAGER_ISOLATED_TEST !== "1" || !/^\/florayn_checkout_test_[a-z0-9_]+$/.test(database.pathname) || !["localhost", "127.0.0.1"].includes(database.hostname) || process.env.REVALIDATE_SECRET || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.STOREFRONT_URL ?? "")) throw new Error("Product Manager tests require the disposable local checkout fixture.")
  const progress = (message: string) => container.resolve(ContainerRegistrationKeys.LOGGER).info(`PRODUCT_MANAGER_CHECK: ${message}`)
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
  progress("regular creation and stock passed")
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
  progress("regular price/gallery edits and appended option values passed")
  await editDesignMeta(container, result.slug!, { name: "Manager edited", description: "Edited description", theme: "Fixture collection", status: "published" })
  await editDesignMeta(container, result.slug!, { theme: "" })
  detail = (await getDesignDetail(container, result.slug!))!
  assert.equal(detail.collection, null)
  assert.equal(detail.products[0].description, "Edited description")
  const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
  const { result: cart } = await createCartWorkflow(container).run({ input: { region_id: regions[0].id, sales_channel_id: channels[0].id, items: [{ variant_id: large.id, quantity: 1 }] } })
  const { data: savedCarts } = await query.graph({ entity: "cart", filters: { id: cart.id }, fields: ["id", "items.variant_id", "items.unit_price"] })
  assert.equal(savedCarts[0].items?.[0]?.variant_id, large.id)
  assert.equal(Number(savedCarts[0].items?.[0]?.unit_price), 525)

  progress("metadata, publish, collection removal and exact cart pricing passed")
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
  progress("single phone pair and dynamic catalog entries passed")
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
  // Persist preferences through the real route and core store workflow. No schema change.
  const stores = container.resolve(Modules.STORE)
  const [store] = await stores.listStores({}, { take: 1 })
  assert.ok(store)
  await stores.updateStores(store.id, { metadata: { ...store.metadata, recommendation_fixture_keep: "preserved" } })
  let response: any
  let status = 200
  const res: any = { json: (data: any) => { response = data; return res }, status: (code: number) => { status = code; return res } }
  const settings = { phone_model: "Manager Model Two", phone_case_type: "Manager Shell", airpods_model: "Manager Earbuds", airpods_case_type: "Manager Shell" }
  await saveRecommendations({ scope: container, body: settings } as any, res)
  assert.equal(status, 200, response?.message)
  assert.deepEqual(response.settings, settings)
  await getRecommendations({ scope: container } as any, res)
  assert.deepEqual(response.settings, settings)
  await publicProductSections({ scope: container } as any, res)
  assert.deepEqual(response.recommendationDefaults, settings)
  const updatedStore = await stores.retrieveStore(store.id)
  assert.equal(updatedStore.metadata?.recommendation_fixture_keep, "preserved")
  assert.deepEqual(updatedStore.metadata?.[RECOMMENDATION_KEY], settings)
  await saveRecommendations({ scope: container, body: { ...settings, airpods_model: settings.phone_model } } as any, res)
  assert.equal(status, 400)
  assert.deepEqual((await stores.retrieveStore(store.id)).metadata?.[RECOMMENDATION_KEY], settings)
  progress("persisted matching defaults, public projection, metadata preservation and family validation passed")
  status = 200
  const footer = { ...DEFAULT_PRESENTATION.footer, tagline: "Isolated footer copy", social: [], note: "", location: "" }
  const delivery = { ...DEFAULT_PRESENTATION.delivery, heading: "Isolated delivery copy", cards: [{ icon: "truck", title: "Custom delivery", description: "Test information only." }], link_label: "", link_href: "" }
  const buy_box = { ...DEFAULT_PRESENTATION.buy_box, buy_now_label: "Order now", sticky_bar: false }
  await savePresentation({ scope: container, params: { section: "footer" }, body: { settings: footer } } as any, res)
  assert.equal(status, 200, response?.message)
  await savePresentation({ scope: container, params: { section: "buy_box" }, body: { settings: buy_box } } as any, res)
  assert.equal(status, 200, response?.message)
  await savePresentation({ scope: container, params: { section: "delivery" }, body: { settings: delivery } } as any, res)
  assert.equal(status, 200, response?.message)
  await getPresentation({ scope: container, params: { section: "footer" } } as any, res)
  assert.deepEqual(response.settings, footer)
  await publicContent({ scope: container } as any, res)
  assert.equal(response.footerAppearance.tagline, footer.tagline)
  assert.equal(response.footerNote, "")
  assert.deepEqual(response.social, [])
  await publicProductSections({ scope: container } as any, res)
  assert.deepEqual(response.delivery, delivery)
  assert.deepEqual(response.buyBox, buy_box)
  const withPresentation = await stores.retrieveStore(store.id)
  assert.equal(withPresentation.metadata?.recommendation_fixture_keep, "preserved")
  assert.deepEqual(withPresentation.metadata?.[RECOMMENDATION_KEY], settings)
  // Saving one section stores every section (the others at their defaults: navigation and search too).
  const savedPresentation = { ...DEFAULT_PRESENTATION, footer, delivery, buy_box }
  assert.deepEqual(withPresentation.metadata?.[PRESENTATION_KEY], savedPresentation)
  await savePresentation({ scope: container, params: { section: "delivery" }, body: { settings: { ...delivery, link_label: "Unsafe", link_href: "javascript:alert(1)" } } } as any, res)
  assert.equal(status, 400)
  assert.deepEqual((await stores.retrieveStore(store.id)).metadata?.[PRESENTATION_KEY], savedPresentation)
  progress("editable footer, delivery and buy buttons persisted, public reads matched, unsafe links rejected and unrelated settings preserved")
  // Exact variant selection, independent ordering, draft rejection, and clearing.
  const picks = { recommended: [large.id, small.id], featured: [small.id] }
  const req: any = { scope: container, params: { id: design.products[0].id }, body: picks }
  await saveManual(req, res)
  assert.deepEqual(response.settings, picks)
  assert.equal(response.choices.find((v: any) => v.id === small.id).image, "https://example.invalid/replaced-version.webp")
  await getManual(req, res)
  assert.deepEqual(response.settings, picks)
  const productService = container.resolve(Modules.PRODUCT)
  assert.equal((await productService.retrieveProduct(req.params.id)).metadata?.design_slug, "manager-one-pair")
  await assert.rejects(() => saveManual({ ...req, body: { ...picks, recommended: [firstVariant.id] } }, res))
  await assert.rejects(() => saveManual({ ...req, body: { ...picks, recommended: [copied.products[0].variants[0].id] } }, res))
  assert.deepEqual((await productService.retrieveProduct(req.params.id)).metadata?.[MANUAL_RECOMMENDATIONS_KEY], picks)
  await saveManual({ ...req, body: { recommended: [], featured: [] } }, res)
  assert.deepEqual(response.settings, { recommended: [], featured: [] })
  await saveBadge({ scope: container, body: { text: "  Up to 20% off  " } } as any, res)
  assert.equal(response.text, "Up to 20% off")
  await publicBundles({ scope: container } as any, res)
  assert.equal(response.settings.badge_text, "Up to 20% off")
  assert.equal((await stores.retrieveStore(store.id)).metadata?.recommendation_fixture_keep, "preserved")
  await assert.rejects(() => saveBadge({ scope: container, body: { text: "x".repeat(33) } } as any, res))
  await saveBadge({ scope: container, body: { text: "" } } as any, res)
  assert.equal(response.text, "")
  progress("manual recommendations, exact variant images, section order, invalid target rejection, clearing and editable bundle badge passed")
  const pageContent = { ...DEFAULT_PRODUCT_CONTENT, facts: [{ label: "Material", value: "Fixture material" }], faqs: [{ question: "Does it fit?", answer: "Choose the fixture model." }] }
  await saveProductContentWorkflow(container).run({ input: { productId: original.id, settings: pageContent } })
  const savedPage = await productService.retrieveProduct(original.id)
  assert.deepEqual(savedPage.metadata?.[PRODUCT_CONTENT_KEY], pageContent)
  assert.equal(savedPage.description, "Edited description")
  const customer = await container.resolve(Modules.CUSTOMER).createCustomers({ email: "review-fixture@example.invalid", first_name: "Fixture" })
  const reviewInput = { productId: original.id, customerId: customer.id, body: { rating: 4, author: "Fixture shopper", title: "Synthetic review", body: "Only a disposable test review.", status: "approved" } }
  const submitted = await submitProductReviewWorkflow(container).run({ input: reviewInput })
  assert.equal(submitted.result.status, "pending")
  assert.equal((await publicReviews(container, original.id)).count, 0)
  await assert.rejects(() => submitProductReviewWorkflow(container).run({ input: reviewInput }))
  await moderateProductReviewWorkflow(container).run({ input: { id: submitted.result.id, status: "approved", reply: "Fixture reply" } })
  const publishedReviews = await publicReviews(container, original.id)
  assert.equal(publishedReviews.count, 1); assert.equal(publishedReviews.average, 4)
  assert.equal(publishedReviews.reviews[0].reply, "Fixture reply")
  assert.equal((publishedReviews.reviews[0] as any).customer_id, undefined)
  await moderateProductReviewWorkflow(container).run({ input: { id: submitted.result.id, status: "rejected", reply: "" } })
  assert.equal((await publicReviews(container, original.id)).count, 0)
  const contentService = container.resolve(CONTENT_MODULE)
  const persisted = await contentService.retrieveProductReview(submitted.result.id)
  assert.equal(persisted.body, "Only a disposable test review.")
  await assert.rejects(() => contentService.createProductReviews({ review_key: persisted.review_key, customer_id: customer.id, product_id: original.id, author: "Fixture", title: "Duplicate", body: "Duplicate fixture review", rating: 5 }))
  await saveProductContentWorkflow(container).run({ input: { productId: original.id, settings: { ...pageContent, reviews_enabled: false } } })
  await assert.rejects(() => publicReviews(container, original.id))
  progress("product FAQ persistence, pending review privacy, moderation, replies, aggregate ratings, duplicate protection and disabling passed")
  await verifyPhoneColours(container, progress, copied.products[0].variants[0].id)
  container.resolve(ContainerRegistrationKeys.LOGGER).info("PRODUCT_MANAGER_INTEGRATION_PASS: regular create/edit/append, exact cart variant and price, draft, single phone pair, dynamic catalogs, missing forms, stable IDs, shared-stock duplicate and phone colour pictures")
}

/**
 * Phone colour pictures (PHONE_COLOURS.md): created through /custom's path plus
 * /colours, the main gallery edited through manager-variants, the rows survive,
 * product.images never holds colour URLs, IDs/prices/shared stock unchanged,
 * the store reads stay published-only, and deleting the design cleans the rows.
 */
async function verifyPhoneColours(container: any, progress: (message: string) => void, foreignVariantId: string) {
  const call = async (handler: (req: any, res: any) => Promise<unknown>, req: Record<string, unknown>) => {
    let status = 200
    let body: any
    const res: any = { json: (data: any) => { body = data; return res }, status: (code: number) => { status = code; return res } }
    await handler({ scope: container, params: {}, query: {}, body: {}, ...req }, res)
    return { status, body: JSON.parse(JSON.stringify(body ?? null)) }
  }
  const saved = await call(saveMockupSettings, { body: {
    case_type: "manager-shell", shots: [1, 2], image_size: 1200, quality: 92, supersample: true,
    sets: [{ device: "manager-model-one", base_url: "https://example.invalid/mockups/manager-model-one/v1", colours: ["Black", "Silver", "Deep Blue"], default_colour: "Black", enabled: false, swatches: { Silver: "#E3E4E5" } }],
  } })
  assert.equal(saved.status, 200, saved.body?.message)
  assert.deepEqual(saved.body.settings.sets[0].swatches, { Silver: "#e3e4e5" })
  assert.deepEqual(saved.body.colour_usage, {})
  const collision = await call(saveMockupSettings, { body: { ...saved.body.settings, sets: [{ ...saved.body.settings.sets[0], colours: ["Deep Blue", "Deep-Blue"], default_colour: "Deep Blue", swatches: undefined }] } })
  assert.equal(collision.status, 400)
  assert.match(collision.body.message, /same web name \(deep-blue\)/)

  const main = ["https://example.invalid/designs/manager-colours/manager-shell/manager-model-one/1-A.webp", "https://example.invalid/designs/manager-colours/manager-shell/manager-model-one/2-A.webp"]
  await createUploadedDesign({ container, name: "Colour fixture", slug: "manager-colours", status: "draft", blankStock: 0, pairs: { "manager-shell": {
    "manager-model-one": main, "manager-model-two": ["https://example.invalid/designs/manager-colours/manager-shell/manager-model-two/1-A.webp"],
  } } })
  let detail = (await getDesignDetail(container, "manager-colours"))!
  const before = detail.products[0].variants.find((v) => v.deviceSlug === "manager-model-one")!
  const other = detail.products[0].variants.find((v) => v.deviceSlug === "manager-model-two")!
  assert.deepEqual(before.phoneColours, { main: null, extra: {} })
  assert.deepEqual(Object.keys(detail.palette), ["manager-model-one"])
  assert.deepEqual(detail.palette["manager-model-one"], { default: "black", colours: [["black", "Black", "#1d1d1f"], ["silver", "Silver", "#e3e4e5"], ["deep-blue", "Deep Blue", "#34405a"]] })

  const silver = ["https://example.invalid/designs/manager-colours/manager-shell/manager-model-one/silver/1-B.webp", "https://example.invalid/designs/manager-colours/manager-shell/manager-model-one/silver/2-B.webp"]
  const blue = ["https://example.invalid/designs/manager-colours/manager-shell/manager-model-one/deep-blue/1-C.webp"]
  const body = { source: "mockup_studio", variants: [{ caseType: "manager-shell", device: "manager-model-one", main: "black", galleries: { silver, "deep-blue": blue }, replace: true }] }
  let result = await call(saveDesignColours, { params: { slug: "manager-colours" }, body })
  assert.equal(result.status, 200, result.body?.message)
  assert.deepEqual(result.body, { saved: 3, removed: 0, warnings: ["Manager Model One: Deep Blue has 1 picture, the main colour has 2. Shoppers switching colour start at picture 1."] })
  result = await call(saveDesignColours, { params: { slug: "manager-colours" }, body })
  assert.equal(result.status, 200, "the same body twice is fine")
  const catalog = container.resolve(CATALOG_MODULE)
  assert.equal((await catalog.listPhoneColourGalleries({ product_id: detail.products[0].id }, { take: 100 })).length, 3, "idempotent: no duplicate rows")

  for (const [variants, pattern] of [
    [[{ variantId: foreignVariantId, main: "black", galleries: {}, replace: true }], /not part of this design/],
    [[{ caseType: "manager-shell", device: "manager-earbuds", main: "black", galleries: {}, replace: true }], /Manager Earbuds has no Manager Shell case in this design/],
    [[{ caseType: "manager-shell", device: "manager-model-two", main: "black", galleries: {}, replace: true }], /Manager Model Two has no phone colours/],
    [[{ caseType: "manager-shell", device: "manager-model-one", main: "pink", galleries: {}, replace: true }], /pink is not a phone colour of Manager Model One/],
    [[{ caseType: "manager-shell", device: "manager-model-one", main: "black", galleries: { silver: ["http://example.invalid/insecure.webp"] }, replace: true }], /HTTPS/],
  ] as const) {
    const refused = await call(saveDesignColours, { params: { slug: "manager-colours" }, body: { source: "manual", variants } })
    assert.equal(refused.status, 400, JSON.stringify(variants))
    assert.match(refused.body.message, pattern)
  }
  assert.equal((await call(saveDesignColours, { params: { slug: "manager-missing" }, body })).status, 404)

  detail = (await getDesignDetail(container, "manager-colours"))!
  let variant = detail.products[0].variants.find((v) => v.id === before.id)!
  assert.deepEqual(variant.phoneColours, { main: "black", extra: { silver, "deep-blue": blue } })
  assert.deepEqual(variant.images, main, "metadata.images stays the main gallery")
  assert.ok(!detail.products[0].images.some((url) => url.includes("/silver/") || url.includes("/deep-blue/")), "colour URLs never enter product.images")
  assert.equal(variant.price, before.price)
  assert.equal(variant.inventory[0].id, before.inventory[0].id)

  // Store reads: nothing while the design is a draft.
  const productId = detail.products[0].id
  let store = await call(storeProductColours, { query: { product_id: productId, device: "manager-model-one" } })
  assert.deepEqual(store.body, {})
  assert.equal((await call(storeVariantColours, { params: { id: before.id } })).status, 404)
  assert.deepEqual((await call(storePhoneColours, { query: { device: "manager-model-one", case_type: "manager-shell" } })).body.colours.map((c: any) => c[3]), [0, 0, 0])
  await editDesignMeta(container, "manager-colours", { status: "published" })
  store = await call(storeProductColours, { query: { product_id: productId, device: "manager-model-one" } })
  assert.deepEqual(store.body.colours, [["black", "Black", "#1d1d1f"], ["silver", "Silver", "#e3e4e5"], ["deep-blue", "Deep Blue", "#34405a"]])
  assert.deepEqual(store.body.variants, { [before.id]: [0, 1, 2] })
  assert.deepEqual(store.body.galleries[before.id].silver.map((tail: string) => expandTail(store.body.base, tail)), silver)
  assert.deepEqual(store.body.galleries[before.id]["deep-blue"].map((tail: string) => expandTail(store.body.base, tail)), blue)
  const otherDevice = await call(storeProductColours, { query: { product_id: productId, device: "manager-model-two" } })
  assert.deepEqual(otherDevice.body.galleries, {}, "galleries only for the requested model")
  const lazy = await call(storeVariantColours, { params: { id: before.id } })
  assert.equal(lazy.status, 200)
  assert.deepEqual(lazy.body.galleries.silver.map((tail: string) => expandTail(lazy.body.base, tail)), silver)
  const palette = await call(storePhoneColours, { query: { device: "manager-model-one", case_type: "manager-shell" } })
  assert.deepEqual(palette.body, { caseType: "manager-shell", default: "black", colours: [["black", "Black", "#1d1d1f", 1], ["silver", "Silver", "#e3e4e5", 1], ["deep-blue", "Deep Blue", "#34405a", 1]] }, "a set switched off in Studio still shows")
  const cards = await call(storeShopCards, { query: { handles: "manager-colours", device: "Manager Model One", case_type: "Manager Shell", colour: "silver" } })
  assert.equal(cards.body.cards[0].colourImage, silver[0])
  assert.equal(cards.body.cards[0].image, main[0], "the card's own image is unchanged")
  const mainCards = await call(storeShopCards, { query: { handles: "manager-colours", device: "Manager Model One", case_type: "Manager Shell", colour: "black" } })
  assert.equal(mainCards.body.cards[0].colourImage, undefined, "the main row gives no colourImage")
  const usage = await call(saveMockupSettings, { body: saved.body.settings })
  assert.deepEqual(usage.body.colour_usage, { "manager-model-one": { "black": 1, "silver": 1, "deep-blue": 1 } })
  progress("phone colours: palette, swatches, /colours create, idempotence, refusals, detail, published-only store reads, lazy galleries and shop cards passed")

  // Move the main colour and drop one colour; then edit the main gallery through manager-variants.
  result = await call(saveDesignColours, { params: { slug: "manager-colours" }, body: { source: "manual", variants: [{ variantId: before.id, main: "silver", galleries: { black: main }, replace: true }] } })
  assert.equal(result.status, 200, result.body?.message)
  assert.equal(result.body.removed, 1)
  const replaced = ["https://example.invalid/designs/manager-colours/manager-shell/manager-model-one/silver/1-D.webp", "https://example.invalid/designs/manager-colours/manager-shell/manager-model-one/silver/2-D.webp"]
  await saveManagedVariantsWorkflow(container).run({ input: { productId, variants: [{ id: before.id, images: replaced }] } })
  detail = (await getDesignDetail(container, "manager-colours"))!
  variant = detail.products[0].variants.find((v) => v.id === before.id)!
  assert.deepEqual(variant.phoneColours, { main: "silver", extra: { black: main } }, "rows survive a main-gallery edit")
  assert.deepEqual(variant.images, replaced)
  assert.ok(detail.products[0].images.includes(replaced[0]))
  assert.ok(!detail.products[0].images.includes(silver[0]) && !detail.products[0].images.includes(blue[0]), "product.images holds main galleries only")
  assert.deepEqual(detail.products[0].variants.map((v) => v.id).sort(), [before.id, other.id].sort(), "variant IDs unchanged")
  assert.equal(variant.price, before.price)
  assert.equal(variant.inventory[0].id, before.inventory[0].id, "shared stock unchanged")
  store = await call(storeProductColours, { query: { product_id: productId, device: "manager-model-one" } })
  assert.deepEqual(store.body.colours.map((c: any) => c[0]), ["black", "silver"])
  assert.deepEqual(store.body.variants[before.id].map((i: number) => store.body.colours[i][0]), ["silver", "black"], "main first")
  // Compensation puts the rows back exactly, IDs included.
  const fields = ["id", "product_id", "variant_id", "device_slug", "case_type_slug", "colour_slug", "is_main", "images", "source"]
  const rowsOf = async () => JSON.parse(JSON.stringify(await catalog.listPhoneColourGalleries({ variant_id: [before.id] }, { select: fields, order: { colour_slug: "ASC" }, take: 100 })))
  const snapshot = await rowsOf()
  await call(saveDesignColours, { params: { slug: "manager-colours" }, body: { source: "manual", variants: [{ variantId: before.id, main: "deep-blue", galleries: {}, replace: true }] } })
  assert.notDeepEqual(await rowsOf(), snapshot)
  await restoreColourRows(catalog, [before.id], snapshot)
  assert.deepEqual(await rowsOf(), snapshot)
  const row = { product_id: productId, variant_id: before.id, device_slug: "manager-model-one", case_type_slug: "manager-shell", images: null, source: "manual" }
  await assert.rejects(() => catalog.createPhoneColourGalleries([{ ...row, colour_slug: "deep-blue", is_main: true }]), Error, "the index allows one main row per variant")
  await assert.rejects(() => catalog.createPhoneColourGalleries([{ ...row, colour_slug: "silver", is_main: false, images: ["https://example.invalid/x.webp"] }]), Error, "one row per variant and colour")
  assert.deepEqual(await rowsOf(), snapshot)
  // One save per variant at a time, each in one transaction: overlapping saves
  // of one variant (a console retry while the first is still running, Product
  // Manager and Studio together) all succeed, one after the other.
  const colours = (body: unknown) => call(saveDesignColours, { params: { slug: "manager-colours" }, body })
  const asBefore = { source: "manual", variants: [{ variantId: before.id, main: "silver", galleries: { black: main }, replace: true }] }
  const swapped = { source: "manual", variants: [{ variantId: before.id, main: "black", galleries: { silver }, replace: true }] }
  const outcome = async () => JSON.stringify((await rowsOf()).map((r: any) => [r.colour_slug, r.is_main, r.images]))
  let both = await Promise.all([colours(swapped), colours(swapped)])
  assert.deepEqual(both.map((r) => r.status), [200, 200], JSON.stringify(both.map((r) => r.body)))
  assert.equal(await outcome(), JSON.stringify([["black", true, null], ["silver", false, silver]]), "two identical saves at once: one main row and exactly the listed colours")
  both = await Promise.all([colours(asBefore), colours(swapped)])
  assert.deepEqual(both.map((r) => r.status), [200, 200], JSON.stringify(both.map((r) => r.body)))
  assert.ok([JSON.stringify([["black", false, main], ["silver", true, null]]), JSON.stringify([["black", true, null], ["silver", false, silver]])].includes(await outcome()), `two different saves at once leave one of their outcomes: ${await outcome()}`)
  // A save that fails part-way changes nothing: the source check refuses the
  // last writes after a delete has already run in the same transaction.
  const settled = await rowsOf()
  await assert.rejects(() => catalog.savePhoneColourRows([{ variantId: before.id, productId, deviceSlug: "manager-model-one", caseTypeSlug: "manager-shell", main: "deep-blue", galleries: { black: main }, replace: true }], "bogus"), Error)
  assert.deepEqual(await rowsOf(), settled, "rolled back: nothing deleted, demoted or created")
  assert.equal((await catalog.listPhoneColourGalleries({ product_id: productId }, { take: 100 })).length, settled.length, "no other rows appeared")

  const removed = await call(deleteDesign, { params: { slug: "manager-colours" } })
  assert.equal(removed.status, 200, removed.body?.message)
  assert.equal((await catalog.listPhoneColourGalleries({ product_id: productId }, { take: 100 })).length, 0, "deleting the design removes its rows")
  progress("phone colours: main move, replace, manager-variants edit keeps rows, stable IDs/prices/stock and delete cleanup passed")
}
