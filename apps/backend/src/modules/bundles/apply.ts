import {
  createPromotionsWorkflow,
  updateCartPromotionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { PromotionActions } from "@medusajs/framework/utils"

import { BUNDLES_MODULE } from "."
import { getBundleConfig } from "./config"
import { lineDiscount } from "./pricing"

/**
 * Turn the multi-buy tiers into a real discount on a cart.
 *
 * The storefront renders the saving from the same tier table, but nothing it
 * sends is trusted: the amounts here are recomputed from the cart's own line
 * quantities and unit prices. The discount is carried by a single-use
 * promotion so Medusa owns the arithmetic on the order, and the admin can see
 * why an order totalled what it did.
 */
export async function applyBundleDiscount({
  scope,
  query,
  cartId,
  logger,
}: {
  scope: any
  query: any
  cartId: string
  logger: { error: (m: string) => void; info: (m: string) => void }
}): Promise<{ discount: number; freeShipping: boolean }> {
  const service: any = scope.resolve(BUNDLES_MODULE)
  const { settings, tiers } = await getBundleConfig(service)

  if (!settings.is_active) {
    return { discount: 0, freeShipping: false }
  }

  const enabled = tiers
    .filter((tier: any) => tier.is_enabled)
    .map((tier: any) => ({
      quantity: tier.quantity,
      discount_amount: tier.discount_amount,
      min_pct: tier.min_pct,
      max_pct: tier.max_pct,
    }))

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "currency_code",
      "subtotal",
      "items.id",
      "items.quantity",
      "items.unit_price",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) {
    return { discount: 0, freeShipping: false }
  }

  let discount = 0
  if (enabled.length) {
    for (const item of cart.items ?? []) {
      const unit = Number(item.unit_price ?? 0)
      const qty = Number(item.quantity ?? 0)
      if (!unit || qty < 2) continue
      discount += lineDiscount(unit, qty, enabled).discount
    }
  }

  const subtotal = Number(cart.subtotal ?? 0)
  const threshold = Number(settings.free_shipping_threshold ?? 0)
  // The threshold is judged on what the customer actually pays for the goods.
  const freeShipping = threshold > 0 && subtotal - discount >= threshold

  const codes: string[] = []

  if (discount > 0) {
    const code = `BUNDLE-${cartId}`
    await ensurePromotion(scope, logger, {
      code,
      application_method: {
        type: "fixed",
        target_type: "order",
        value: discount,
        currency_code: cart.currency_code,
      },
    })
    codes.push(code)
  }

  if (freeShipping) {
    const code = `FREESHIP-${cartId}`
    await ensurePromotion(scope, logger, {
      code,
      application_method: {
        type: "percentage",
        target_type: "shipping_methods",
        allocation: "each",
        value: 100,
        max_quantity: 1,
        currency_code: cart.currency_code,
      },
    })
    codes.push(code)
  }

  if (codes.length) {
    await updateCartPromotionsWorkflow(scope).run({
      input: { cart_id: cartId, promo_codes: codes, action: PromotionActions.ADD },
    })
    logger.info(
      `Checkout: applied ${codes.join(", ")} to ${cartId} (discount ${discount})`
    )
  }

  return { discount, freeShipping }
}

/**
 * Create the promotion, tolerating one that is already there. A shopper who
 * submits checkout twice - a double click, a retried request - must not be
 * blocked by a code left behind from the first attempt.
 */
async function ensurePromotion(
  scope: any,
  logger: { error: (m: string) => void },
  promotion: Record<string, unknown>
) {
  try {
    await createPromotionsWorkflow(scope).run({
      input: {
        promotionsData: [
          { type: "standard", status: "active", ...promotion } as any,
        ],
      },
    })
  } catch (error: any) {
    const message = String(error?.message ?? error)
    // Anything other than "it already exists" is a real problem.
    if (!/already exists|duplicate|unique/i.test(message)) {
      throw error
    }
    logger.error(`Bundle promotion already present, reusing: ${message}`)
  }
}
