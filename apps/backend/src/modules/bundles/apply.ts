import {
  createPromotionsWorkflow,
  createPromotionRulesWorkflow,
  updatePromotionsWorkflow,
  updateCartPromotionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { Modules, PromotionActions, RuleType } from "@medusajs/framework/utils"

import { BUNDLES_MODULE } from "."
import { getBundleConfig, withMatchingSetDefaults } from "./config"
import { cartBundleDiscount, matchingSetDiscount } from "./pricing"
import { DEVICES } from "../catalog/data/devices"
import { checkoutCartSnapshot } from "../../lib/checkout-cart-snapshot"

/*
 * Device name -> whether it is a phone case. A line's variant title is the
 * device name (the seed sets it so), so this is how a cart line is classified
 * as a case or an accessory when the bundle scope is "cases".
 */
const CASE_BY_DEVICE_NAME: Map<string, boolean> = new Map(
  DEVICES.map((d) => [d.name, d.family === "iphone" || d.family === "samsung"])
)

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
}): Promise<{ discount: number; freeShipping: boolean; cartSnapshot: string }> {
  const service: any = scope.resolve(BUNDLES_MODULE)
  const { settings, tiers } = await getBundleConfig(service)

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
      "item_subtotal",
      "items.id",
      "items.quantity",
      "items.unit_price",
      // The device name, used to tell a phone case from an accessory when the
      // bundle scope is "cases".
      "items.variant_title",
      // Product form + design, used to match a phone + AirPods set.
      "items.product.metadata",
      "promotions.code",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) {
    return { discount: 0, freeShipping: false, cartSnapshot: "[]" }
  }

  const lines = (cart.items ?? []).map((item: any) => ({
    unit_price: Number(item.unit_price ?? 0),
    quantity: Number(item.quantity ?? 0),
    // Unknown titles are treated as NOT a case, so scope "cases" never
    // discounts something it cannot confirm is a phone case.
    is_case: item.product?.metadata?.form === "phone" ||
      String(item.variant_title ?? "").split(/\s*\/\s*/).some((name) => CASE_BY_DEVICE_NAME.get(name) === true),
    form: (item.product?.metadata?.form as string) ?? undefined,
    design: (item.product?.metadata?.design_slug as string) ?? undefined,
  }))

  let discount = 0
  if (settings.is_active && enabled.length) {
    discount += cartBundleDiscount(lines, enabled, { scope: settings.scope })
  }

  const ms = withMatchingSetDefaults(settings)
  discount += matchingSetDiscount(lines, {
    enabled: !!settings.is_active && !!ms.matching_set_enabled,
    discount: Number(ms.matching_set_discount ?? 0),
  })

  const subtotal = Number(cart.item_subtotal ?? lines.reduce((sum: number, line: any) => sum + line.unit_price * line.quantity, 0))
  const threshold = Number(settings.free_shipping_threshold ?? 0)
  // The threshold is judged on what the customer actually pays for the goods.
  discount = Math.min(Math.max(0, subtotal), discount)
  const freeShipping = !!settings.is_active && threshold > 0 && subtotal - discount >= threshold

  const codes: string[] = []

  if (discount > 0) {
    const code = `BUNDLE-${cartId}`
    await ensurePromotion(scope, {
      code,
      application_method: {
        type: "fixed",
        target_type: "order",
        value: discount,
        currency_code: cart.currency_code,
      },
      rules: [{ attribute: "id", operator: "eq", values: [cartId] }],
    })
    codes.push(code)
  }

  if (freeShipping) {
    const code = `FREESHIP-${cartId}`
    await ensurePromotion(scope, {
      code,
      application_method: {
        type: "percentage",
        target_type: "shipping_methods",
        allocation: "each",
        value: 100,
        max_quantity: 1,
        currency_code: cart.currency_code,
      },
      rules: [{ attribute: "id", operator: "eq", values: [cartId] }],
    })
    codes.push(code)
  }

  // Replace only our cart-specific offers; preserve any genuine Medusa coupon.
  // ADD alone leaves stale savings/free shipping on a reduced or edited cart.
  const otherCodes = (cart.promotions ?? []).map((p: any) => p.code)
    .filter((code: string) => code !== `BUNDLE-${cartId}` && code !== `FREESHIP-${cartId}`)
  await updateCartPromotionsWorkflow(scope).run({
    input: { cart_id: cartId, promo_codes: [...otherCodes, ...codes], action: PromotionActions.REPLACE },
  })

  return { discount, freeShipping, cartSnapshot: checkoutCartSnapshot(cart) }
}

/**
 * Keep a cart's existing promotion synchronized after changes and retries.
 * The caller holds the checkout lock while creating or updating these codes.
 */
async function ensurePromotion(
  scope: any,
  promotion: Record<string, unknown>
) {
  const service = scope.resolve(Modules.PROMOTION)
  const [existing] = await service.listPromotions({ code: promotion.code }, { take: 1, relations: ["rules", "rules.values"] })
  if (existing) {
    const { rules, ...update } = promotion
    await updatePromotionsWorkflow(scope).run({
      input: { promotionsData: [{ id: existing.id, ...update } as any] },
    })
    // Older codes had no cart restriction. Rules have a dedicated workflow;
    // they are not nested updates accepted by updatePromotionsWorkflow.
    if (!existing.rules?.some((rule: any) => rule.attribute === "id")) {
      await createPromotionRulesWorkflow(scope).run({ input: {
        rule_type: RuleType.RULES, data: { id: existing.id, rules: rules as any },
      } })
    }
  } else {
    await createPromotionsWorkflow(scope).run({
      input: {
        promotionsData: [
          { type: "standard", status: "active", ...promotion } as any,
        ],
      },
    })
  }
}
