import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  isDistrict,
  isValidPhone,
  normalizePhone,
  SHIPPING,
  SHIPPING_OPTION_NAMES,
  zoneForDistrict,
} from "../../../modules/catalog/data/bangladesh"

/**
 * One-shot checkout: address, shipping, Cash on Delivery and completion in a
 * single request, because the storefront checkout is a single page.
 *
 * Shipping is priced here from the district and the cart subtotal. The client
 * sends a district, never an amount, so a customer cannot select free delivery
 * by editing the request.
 *
 * POST /store/checkout
 */

const COD_PROVIDER_ID = "pp_system_default"

type CheckoutBody = {
  cart_id?: string
  full_name?: string
  phone?: string
  email?: string
  address?: string
  district?: string
  area?: string
  note?: string
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) {
    return { first: parts[0], last: "" }
  }
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body ?? {}) as CheckoutBody

  const errors: Record<string, string> = {}

  const cartId = (body.cart_id ?? "").trim()
  const fullName = (body.full_name ?? "").trim()
  const phoneRaw = (body.phone ?? "").trim()
  const address = (body.address ?? "").trim()
  const district = (body.district ?? "").trim()
  const area = (body.area ?? "").trim()
  const email = (body.email ?? "").trim()

  if (!cartId) {
    errors.cart_id = "Missing cart."
  }
  if (fullName.length < 2) {
    errors.full_name = "Enter the full name for delivery."
  }
  if (!isValidPhone(phoneRaw)) {
    errors.phone = "Enter an 11 digit mobile number, like 01712345678."
  }
  if (address.length < 5) {
    errors.address = "Enter the full delivery address."
  }
  if (!district) {
    errors.district = "Select a district."
  } else if (!isDistrict(district)) {
    errors.district = "That is not a Bangladeshi district."
  }
  if (!area) {
    errors.area = "Enter the area or thana."
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.email = "That email address does not look right."
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ errors })
  }

  const phone = normalizePhone(phoneRaw)

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "subtotal", "currency_code", "completed_at", "items.id"],
    filters: { id: cartId },
  })
  const cart = carts?.[0]

  if (!cart) {
    return res.status(404).json({ errors: { cart_id: "Cart not found." } })
  }
  if (cart.completed_at) {
    return res
      .status(409)
      .json({ errors: { cart_id: "This cart has already been ordered." } })
  }
  if (!cart.items?.length) {
    return res.status(400).json({ errors: { cart_id: "Your cart is empty." } })
  }

  const subtotal = Number(cart.subtotal ?? 0)
  const zone = zoneForDistrict(district)
  const isFree = subtotal >= SHIPPING.freeThreshold
  const optionName = isFree
    ? SHIPPING_OPTION_NAMES[zone].free
    : SHIPPING_OPTION_NAMES[zone].paid

  const { data: shippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
  })
  const shippingOption = shippingOptions?.find((o: any) => o.name === optionName)

  if (!shippingOption) {
    logger.error(`Checkout: no shipping option named "${optionName}"`)
    return res.status(500).json({
      errors: { district: "Delivery is not configured for that district yet." },
    })
  }

  const { first, last } = splitName(fullName)

  // Medusa requires an email to complete a cart, but most customers here do not
  // have one. Synthesise a routable-looking address from the phone number and
  // record that it was generated, so nobody mistakes it for a real inbox.
  const hasRealEmail = Boolean(email)
  const cartEmail = hasRealEmail ? email : `${phone}@no-email.florayn.local`

  const shippingAddress = {
    first_name: first,
    last_name: last,
    phone,
    address_1: address,
    address_2: area,
    city: area,
    province: district,
    country_code: "bd",
    postal_code: "",
  }

  try {
    await updateCartWorkflow(req.scope).run({
      input: {
        id: cartId,
        email: cartEmail,
        shipping_address: shippingAddress,
        billing_address: shippingAddress,
        metadata: {
          district,
          area,
          shipping_zone: zone,
          free_shipping: isFree,
          customer_phone: phone,
          customer_has_email: hasRealEmail,
          payment_method: "cash_on_delivery",
          ...(body.note ? { order_note: body.note.trim() } : {}),
        },
      },
    })

    await addShippingMethodToCartWorkflow(req.scope).run({
      input: { cart_id: cartId, options: [{ id: shippingOption.id }] },
    })

    const { result: paymentCollection } =
      await createPaymentCollectionForCartWorkflow(req.scope).run({
        input: { cart_id: cartId },
      })

    await createPaymentSessionsWorkflow(req.scope).run({
      input: {
        payment_collection_id: (paymentCollection as any).id,
        provider_id: COD_PROVIDER_ID,
        data: { method: "cash_on_delivery" },
      },
    })

    const { result: completed } = await completeCartWorkflow(req.scope).run({
      input: { id: cartId },
    })

    const orderId = (completed as any).id

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "total", "currency_code"],
      filters: { id: orderId },
    })
    const order = orders?.[0]

    return res.status(200).json({
      order: {
        id: orderId,
        display_id: order?.display_id ?? null,
        total: order?.total ?? null,
        currency_code: order?.currency_code ?? "bdt",
      },
    })
  } catch (error: any) {
    logger.error(`Checkout failed for cart ${cartId}: ${error?.message}`)
    return res.status(500).json({
      errors: {
        form:
          "We could not place the order. Nothing has been charged - please try again.",
      },
    })
  }
}
