import { createHmac, timingSafeEqual } from "node:crypto"
import { Buffer } from "node:buffer"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
  refreshPaymentCollectionForCartWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows"

import { validateCheckoutBody, type CheckoutFields } from "../lib/checkout-validation"
import { checkoutCartSnapshot } from "../lib/checkout-cart-snapshot"
import { applyBundleDiscount } from "../modules/bundles/apply"
import { SHIPPING_OPTION_NAMES, zoneForDistrict } from "../modules/catalog/data/bangladesh"

const COD_PROVIDER = "pp_system_default"
const CART_FIELDS = [
  "id", "completed_at", "currency_code", "item_subtotal", "item_discount_total",
  "item_tax_total", "shipping_total", "shipping_subtotal", "total",
  "payment_collection.id", "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.provider_id", "payment_collection.payment_sessions.status",
  "items.id", "items.title", "items.variant_title", "items.variant_id", "items.quantity",
  "items.unit_price", "items.subtotal", "items.total", "items.thumbnail",
  "items.variant.metadata",
  "shipping_address.*", "metadata",
]

export type CheckoutQuote = {
  version: string
  currency_code: string
  subtotal: number
  discount_total: number
  bundle_discount: number
  shipping_total: number
  shipping_subtotal: number
  tax_total: number
  total: number
  free_shipping: boolean
  shipping_option_id: string
  shipping_label: string
  district: string
  item_count: number
  payment_method: "cash_on_delivery"
  items: { id: string; title: string; variant_title: string; quantity: number;
    unit_price: number; subtotal: number; total: number; thumbnail: string | null }[]
}

export type CheckoutResult = { status: number; body: Record<string, any> }

export function quoteVersionsMatch(expected: unknown, actual: string): boolean {
  return typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected) &&
    /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"))
}

function failure(status: number, field: string, message: string): CheckoutResult {
  return { status, body: { errors: { [field]: message } } }
}

export function quoteFromCart(cart: any, district: string, shipping: any, discount: number): CheckoutQuote {
  const items = (cart.items ?? []).map((item: any) => ({
    id: item.id, title: item.title, variant_title: item.variant_title ?? "",
    quantity: Number(item.quantity), unit_price: Number(item.unit_price),
    subtotal: Number(item.subtotal), total: Number(item.total),
    thumbnail: Array.isArray(item.variant?.metadata?.images) && typeof item.variant.metadata.images[0] === "string"
      ? item.variant.metadata.images[0] : item.thumbnail ?? null,
  }))
  const amounts = {
    subtotal: Number(cart.item_subtotal), discount_total: Number(cart.item_discount_total ?? (cart.items ?? []).reduce((sum: number, item: any) => sum + Number(item.discount_total ?? 0), 0)),
    shipping_total: Number(cart.shipping_total), shipping_subtotal: Number(cart.shipping_subtotal),
    tax_total: Number(cart.item_tax_total ?? 0), total: Number(cart.total),
  }
  if (Object.values(amounts).some((amount) => !Number.isFinite(amount) || amount < 0)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid checkout totals")
  }
  // Stable across quote reads, but changes if the chosen model, quantities,
  // item prices, discounts, delivery or payable amount changes.
  const secret = process.env.JWT_SECRET
  if (!secret) throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "Checkout signing secret is not configured")
  // Cart metadata is writable through the public Store API. A plain hash can
  // be forged there, so only a server-signed financial snapshot is accepted.
  const version = createHmac("sha256", secret).update("florayn-checkout-quote:v1\n").update(JSON.stringify({
    cart: cart.id, currency: cart.currency_code, district, shipping: shipping.id,
    ...amounts, lines: (cart.items ?? []).map((item: any) => [item.id, item.variant_id,
      item.quantity, Number(item.unit_price), Number(item.total)]).sort((a: any[], b: any[]) => String(a[0]).localeCompare(String(b[0]))),
  })).digest("hex")
  return {
    version, currency_code: cart.currency_code, ...amounts, bundle_discount: discount,
    free_shipping: amounts.shipping_total === 0,
    shipping_option_id: shipping.id, shipping_label: shipping.name, district,
    item_count: items.reduce((sum: number, item: any) => sum + item.quantity, 0),
    payment_method: "cash_on_delivery", items,
  }
}

async function readCart(query: any, cartId: string) {
  const { data } = await query.graph({ entity: "cart", fields: CART_FIELDS, filters: { id: cartId } })
  return data?.[0]
}

async function recoverOrder(query: any, cartId: string): Promise<CheckoutResult | null> {
  const { data: links } = await query.graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
  const id = links?.[0]?.order_id
  if (!id) return null
  const { data: orders } = await query.graph({ entity: "order", fields: ["id", "display_id", "total", "currency_code"], filters: { id } })
  return orders?.[0] ? { status: 200, body: { order: orders[0] } } : null
}

function deliveryAddress(fields: CheckoutFields) {
  const names = fields.full_name.split(/\s+/)
  return {
    first_name: names.length > 1 ? names.slice(0, -1).join(" ") : names[0],
    last_name: names.length > 1 ? names[names.length - 1] : "",
    phone: fields.phone, address_1: fields.address, address_2: fields.area,
    city: fields.area, province: fields.district, country_code: "bd", postal_code: "",
  }
}

/** Called only inside the checkout workflow, under a per-cart checkout lock. */
async function prepareQuote(scope: any, query: any, fields: CheckoutFields, cart: any, complete: boolean) {
  const current = cart.shipping_address ?? {}
  const address = complete ? deliveryAddress(fields) : {
    first_name: current.first_name ?? "", last_name: current.last_name ?? "",
    phone: current.phone ?? "", address_1: current.address_1 ?? "", address_2: current.address_2 ?? "",
    city: current.province === fields.district ? current.city ?? "" : "",
    postal_code: "", country_code: "bd", province: fields.district,
  }
  await updateCartWorkflow(scope).run({ input: {
    id: fields.cart_id, shipping_address: address,
    ...(complete ? {
      billing_address: address,
      email: fields.email || `${fields.phone}@no-email.florayn.local`,
      metadata: { ...cart.metadata, district: fields.district, area: fields.area,
        shipping_zone: zoneForDistrict(fields.district), customer_phone: fields.phone,
        customer_has_email: Boolean(fields.email), payment_method: "cash_on_delivery",
        order_note: fields.note || null },
    } : {}),
  } })
  const { result: options } = await listShippingOptionsForCartWithPricingWorkflow(scope).run({
    input: { cart_id: fields.cart_id },
  })
  const name = SHIPPING_OPTION_NAMES[zoneForDistrict(fields.district)]
  const shipping = options.find((option: any) => option.name === name)
  if (!shipping || shipping.calculated_price?.calculated_amount == null) return {
    error: failure(422, "district", "Delivery is currently unavailable for this district. Please contact us for help."),
  }
  await addShippingMethodToCartWorkflow(scope).run({ input: {
    cart_id: fields.cart_id, options: [{ id: shipping.id }],
  } })
  const bundle = await applyBundleDiscount({ scope, query, cartId: fields.cart_id,
    logger: scope.resolve(ContainerRegistrationKeys.LOGGER) })
  const pricedCart = await readCart(query, fields.cart_id)
  if (!pricedCart || checkoutCartSnapshot(pricedCart) !== bundle.cartSnapshot) return {
    error: failure(409, "form", "Your bag changed while delivery was being calculated. Please refresh the delivery total and try again."),
  }
  return { quote: quoteFromCart(pricedCart, fields.district, shipping, bundle.discount), cart: pricedCart }
}

/** Quote/complete share one source of truth and serialize retries for this cart. */
export async function runCheckout(scope: any, body: unknown, complete: boolean): Promise<CheckoutResult> {
  const { fields, errors } = validateCheckoutBody(body, complete)
  if (Object.keys(errors).length) return { status: 400, body: { errors } }
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const locking = scope.resolve(Modules.LOCKING)
  try {
    // Use a different key from Medusa's cart lock: inner core workflows acquire
    // their own cart locks, and nesting the same key would deadlock.
    return await locking.execute(`florayn-checkout:${fields.cart_id}`, async () => {
      const existing = await recoverOrder(query, fields.cart_id)
      if (existing) return complete ? existing : failure(409, "form", "This bag has already been ordered. Open your order confirmation or start a new bag.")
      const cart = await readCart(query, fields.cart_id)
      if (!cart) return failure(404, "cart_id", "Your bag could not be found. Return to your bag and try again.")
      if (cart.completed_at) return failure(409, "form", "Your order is being confirmed. Please try again in a moment.")
      if (!cart.items?.length) return failure(400, "cart_id", "Your bag is empty. Add an item to continue.")

      const prepared = await prepareQuote(scope, query, fields, cart, complete)
      if (prepared.error) return prepared.error
      const quote = prepared.quote!
      if (!complete) return { status: 200, body: { quote } }
      if (!quoteVersionsMatch(fields.quote_version, quote.version)) return { status: 409, body: {
        errors: { form: "Your bag or delivery total has changed. Review the updated summary and place your order again." }, quote,
      } }

      // A failed earlier completion can leave a collection behind. Refresh and
      // reuse it instead of attempting to create another one.
      let collectionId = prepared.cart.payment_collection?.id
      if (collectionId) {
        await refreshPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: fields.cart_id } })
      } else {
        const { result } = await createPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: fields.cart_id } })
        collectionId = result.id
      }
      const paymentCart = await readCart(query, fields.cart_id)
      const session = paymentCart.payment_collection?.payment_sessions?.find((p: any) =>
        p.provider_id === COD_PROVIDER && ["pending", "authorized"].includes(p.status))
      if (!session) await createPaymentSessionsWorkflow(scope).run({ input: {
        payment_collection_id: collectionId, provider_id: COD_PROVIDER, data: { method: "cash_on_delivery" },
      } })
      // A second tab can change the bag via Medusa's standard cart endpoints.
      // Compare immediately before completion; never use client-supplied money.
      const latestCart = await readCart(query, fields.cart_id)
      const latest = quoteFromCart(latestCart, fields.district,
        { id: quote.shipping_option_id, name: quote.shipping_label }, quote.bundle_discount)
      if (!quoteVersionsMatch(quote.version, latest.version)) {
        // The latest read may still contain a fixed bundle discount calculated
        // for the previous quantities. Reprice before issuing another signature.
        const refreshed = await prepareQuote(scope, query, fields, latestCart, true)
        if (refreshed.error) return refreshed.error
        return { status: 409, body: {
          errors: { form: "Your bag changed in another tab. Review the updated summary and try again." }, quote: refreshed.quote,
        } }
      }
      await scope.resolve(Modules.CART).updateCarts(fields.cart_id, {
        metadata: { ...latestCart.metadata, checkout_quote_version: quote.version, free_shipping: quote.free_shipping,
          // Replace any public-cart metadata with the server's selected images.
          // Core completion copies this compact snapshot onto the order.
          checkout_item_images: Object.fromEntries((latestCart.items ?? []).filter((item: any) => item.variant_id)
            .map((item: any) => [item.variant_id, latest.items.find((line) => line.id === item.id)?.thumbnail ?? null])),
        },
      })
      await completeCartWorkflow(scope).run({ input: { id: fields.cart_id } })
      const order = await recoverOrder(query, fields.cart_id)
      if (order) return order
      return failure(503, "form", "Your order confirmation is taking longer than expected. Try again to retrieve it safely.")
    }, { timeout: 120 })
  } catch (error: any) {
    // A lost response after successful completion must recover the original
    // order, not instruct the shopper to place a second one.
    if (complete) {
      try { const recovered = await recoverOrder(query, fields.cart_id); if (recovered) return recovered } catch { /* retry can recover later */ }
    }
    if (complete && /CHECKOUT_QUOTE_CHANGED/.test(String(error?.message ?? ""))) {
      const refreshed = await runCheckout(scope, body, false)
      return { status: 409, body: { errors: { form: "Your bag changed. Review the updated total and place your order again." },
        ...(refreshed.body.quote ? { quote: refreshed.body.quote } : {}) } }
    }
    logger.error(error?.message === "Checkout signing secret is not configured"
      ? error.message : `Checkout ${complete ? "completion" : "quote"} failed (${error?.type ?? "request"})`)
    const unavailable = /inventory|stock|not available|not enough/i.test(String(error?.message ?? ""))
    return failure(unavailable ? 409 : 503, "form", unavailable
      ? "An item is no longer available in the selected quantity. Update your bag and try again."
      : complete ? "We could not confirm your order yet. Please try again; an already placed order will be recovered safely."
        : "We could not calculate delivery right now. Please try again.")
  }
}
