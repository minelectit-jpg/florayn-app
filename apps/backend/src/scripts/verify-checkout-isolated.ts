import assert from "node:assert/strict"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createCartWorkflow, createProductsWorkflow, createRegionsWorkflow,
  createSalesChannelsWorkflow, createShippingOptionsWorkflow, createStockLocationsWorkflow,
  createTaxRegionsWorkflow, linkSalesChannelsToStockLocationWorkflow,
  updateLineItemInCartWorkflow, updateCartWorkflow, completeCartWorkflow,
  createPaymentCollectionForCartWorkflow, createPaymentSessionsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"
import { checkoutWorkflow } from "../workflows/checkout"
import { orderSummaryWorkflow } from "../workflows/order-summary"

// Medusa serializes step errors before workflow-export throws errors[0].error.
// These can be plain objects, so assert.rejects' Error-to-string regex loses
// their message. Match the exact expected failure across documented wrappers.
export function isExpectedWorkflowFailure(error: unknown, message: string): boolean {
  const pending: unknown[] = [error]
  const seen = new Set<unknown>()
  while (pending.length && seen.size < 20) {
    const value = pending.shift()
    if (!value || typeof value !== "object" || seen.has(value)) continue
    seen.add(value)
    const failure = value as Record<string, unknown>
    if (failure.message === message) return true
    pending.push(failure.error, failure.cause)
    if (Array.isArray(failure.errors)) pending.push(...failure.errors)
  }
  return false
}

/** Only for a disposable database, never the application database. */
export default async function verifyCheckoutIsolated({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid")
  if (process.env.CHECKOUT_ISOLATED_TEST !== "1" ||
    !/^\/florayn_checkout_test_[a-z0-9_]+$/.test(database.pathname)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED,
      "This test requires CHECKOUT_ISOLATED_TEST=1 and a dedicated florayn_checkout_test_* database.")
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const { data: existingOrders } = await query.graph({ entity: "order", fields: ["id"] })
  assert.equal(existingOrders.length, 0, "The disposable test database must not contain orders")
  const { result: channels } = await createSalesChannelsWorkflow(container).run({ input: {
    salesChannelsData: [{ name: "Checkout disposable test" }],
  } })
  const { result: regions } = await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "Checkout test Bangladesh", currency_code: "bdt", countries: ["bd"],
    payment_providers: ["pp_system_default"], automatic_taxes: true,
  }] } })
  await createTaxRegionsWorkflow(container).run({ input: [{ country_code: "bd", provider_id: "tp_system" }] })
  const { result: locations } = await createStockLocationsWorkflow(container).run({ input: {
    locations: [{ name: "Checkout test location", address: { country_code: "BD", city: "Dhaka", address_1: "Test Warehouse" } }],
  } })
  const fulfillment: any = container.resolve(Modules.FULFILLMENT)
  const profile = await fulfillment.createShippingProfiles({ name: "Checkout test shipping", type: "default" })
  const set = await fulfillment.createFulfillmentSets({ name: "Checkout test fulfillment", type: "shipping",
    service_zones: [{ name: "Checkout test BD zone", geo_zones: [{ country_code: "bd", type: "country" }] }],
  })
  await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: locations[0].id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" } })
  await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: locations[0].id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: set.id } })
  await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: locations[0].id, add: [channels[0].id] } })
  await createShippingOptionsWorkflow(container).run({ input: [
    { name: "Inside Dhaka", amount: 73, code: "inside-dhaka" },
    { name: "Outside Dhaka", amount: 113, code: "outside-dhaka" },
  ].map(({ name, amount, code }) => ({ name, price_type: "flat", provider_id: "manual_manual",
    service_zone_id: set.service_zones[0].id, shipping_profile_id: profile.id,
    type: { label: name, description: "Disposable checkout test", code },
    prices: [{ currency_code: "bdt", amount }, { region_id: regions[0].id, amount }],
    rules: [{ attribute: "enabled_in_store", value: "true", operator: "eq" },
      { attribute: "is_return", value: "false", operator: "eq" }],
  })) as any })
  const unitPrice = 1400 // BDT major units, the current Signature case price.
  const { result: products } = await createProductsWorkflow(container).run({ input: { products: [{
    title: "Checkout fixture design", handle: "checkout-fixture", status: "published",
    shipping_profile_id: profile.id, metadata: { form: "phone", design_slug: "checkout-fixture" },
    sales_channels: [{ id: channels[0].id }],
    options: [{ title: "Case Type", values: ["Signature"] }, { title: "Model", values: ["iPhone 17 Pro"] }],
    variants: [{ title: "Signature / iPhone 17 Pro", sku: "CHECKOUT-ONLY", manage_inventory: false,
      metadata: { images: ["https://example.invalid/selected-case.webp"] },
      options: { "Case Type": "Signature", Model: "iPhone 17 Pro" },
      prices: [{ currency_code: "bdt", amount: unitPrice }],
    }],
  }] } })
  const { result: cart } = await createCartWorkflow(container).run({ input: {
    region_id: regions[0].id, sales_channel_id: channels[0].id,
    items: [{ variant_id: products[0].variants![0].id, quantity: 3 }],
  } })
  const body = { cart_id: cart.id, district: "Dhaka", full_name: "Checkout Fixture", phone: "০১৭১২৩৪৫৬৭৮",
    address: "12 Test Road", area: "Test Area", email: "fixture@example.invalid" }
  const run = async (complete = false, extra: Record<string, unknown> = {}) =>
    (await checkoutWorkflow(container).run({ input: { body: { ...body, ...extra }, complete } })).result
  const first = await run()
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.quote.subtotal, 4200)
  assert.equal(first.body.quote.discount_total, 800)
  assert.equal(first.body.quote.shipping_subtotal, 73)
  assert.equal(first.body.quote.shipping_total, 0)
  assert.equal(first.body.quote.total, 3400)
  const outside = await run(false, { district: "Gazipur" })
  assert.equal(outside.status, 200, JSON.stringify(outside.body))
  assert.equal(outside.body.quote.shipping_subtotal, 113)
  assert.equal(outside.body.quote.shipping_total, 0)
  assert.equal(outside.body.quote.total, 3400)
  const second = await run()
  assert.equal(second.body.quote.version, first.body.quote.version, "Repeated quote must be stable")
  // Standard Store endpoints expose metadata and completion too. They must
  // never bypass the signed quote or retain an ineligible fixed promotion.
  await updateCartWorkflow(container).run({ input: { id: cart.id,
    email: body.email, shipping_address: { first_name: "Checkout", last_name: "Fixture",
      phone: "01712345678", address_1: body.address, city: body.area, province: "Dhaka", country_code: "bd" },
  } })
  const { result: paymentCollection } = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: cart.id } })
  const initiatePayment = () => createPaymentSessionsWorkflow(container).run({ input: {
    payment_collection_id: paymentCollection.id, provider_id: "pp_system_default", data: { method: "cash_on_delivery" },
  } })
  await initiatePayment()
  await assert.rejects(completeCartWorkflow(container).run({ input: { id: cart.id } }),
    (error: unknown) => isExpectedWorkflowFailure(error, "CHECKOUT_QUOTE_REQUIRED"))
  await updateCartWorkflow(container).run({ input: { id: cart.id, metadata: { checkout_quote_version: "a".repeat(64) } } })
  await assert.rejects(completeCartWorkflow(container).run({ input: { id: cart.id } }),
    (error: unknown) => isExpectedWorkflowFailure(error, "CHECKOUT_QUOTE_CHANGED"))
  await updateCartWorkflow(container).run({ input: { id: cart.id, metadata: { checkout_quote_version: first.body.quote.version } } })
  await updateLineItemInCartWorkflow(container).run({ input: {
    cart_id: cart.id, item_id: first.body.quote.items[0].id, update: { quantity: 2 },
  } })
  await initiatePayment()
  await assert.rejects(completeCartWorkflow(container).run({ input: { id: cart.id } }),
    (error: unknown) => isExpectedWorkflowFailure(error, "CHECKOUT_QUOTE_CHANGED"))
  const { data: bypassOrders } = await query.graph({ entity: "order", fields: ["id"] })
  assert.equal(bypassOrders.length, 0, "No unsigned, forged or stale quote may create an order")
  const changed = await run(true, { quote_version: first.body.quote.version })
  assert.equal(changed.status, 409, JSON.stringify(changed.body))
  assert.equal(changed.body.quote.discount_total, 300)
  assert.equal(changed.body.quote.shipping_total, 73)
  assert.equal(changed.body.quote.total, 2573)
  const [ordered, concurrent] = await Promise.all([
    run(true, { quote_version: changed.body.quote.version }),
    run(true, { quote_version: changed.body.quote.version }),
  ])
  assert.equal(ordered.status, 200, JSON.stringify(ordered.body))
  assert.equal(concurrent.status, 200, JSON.stringify(concurrent.body))
  assert.equal(concurrent.body.order.id, ordered.body.order.id)
  assert.equal(ordered.body.order.total, 2573)
  const retries = await Promise.all([run(true, { quote_version: changed.body.quote.version }), run(true, { quote_version: changed.body.quote.version })])
  for (const retry of retries) assert.equal(retry.body.order.id, ordered.body.order.id)
  const { data: orders } = await query.graph({ entity: "order", fields: ["id", "total"] })
  assert.equal(orders.length, 1)
  // Verify the real order graph's computed fields, payment aggregation and
  // immutable selected image snapshot without reading any application orders.
  const readSummary = async () => (await orderSummaryWorkflow(container).run({ input: { id: ordered.body.order.id } })).result!
  const summary = await readSummary()
  assert.equal(summary.subtotal, 2800)
  assert.equal(summary.discount_total, 300)
  assert.equal(summary.shipping_total, 73)
  assert.equal(summary.tax_total, 0)
  assert.equal(summary.total, 2573)
  assert.equal(summary.items[0].total, 2500)
  assert.equal(summary.items[0].thumbnail, "https://example.invalid/selected-case.webp")
  assert.equal(summary.payment_status, "authorized")
  assert.equal(summary.delivery.phone, "017*****678")
  assert.ok(!("metadata" in summary) && !("email" in summary))
  await updateProductVariantsWorkflow(container).run({ input: { product_variants: [{
    id: products[0].variants![0].id, metadata: { images: ["https://example.invalid/changed-after-order.webp"] },
  }] } })
  assert.equal((await readSummary()).items[0].thumbnail, "https://example.invalid/selected-case.webp")
  logger.info("CHECKOUT_INTEGRATION_PASS: real pricing, both delivery zones, current bundle, signed quote bypass prevention, edited cart, COD completion and concurrent safe retries")
}
