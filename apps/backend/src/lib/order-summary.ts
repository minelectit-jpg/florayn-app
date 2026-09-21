import { getLastPaymentStatus } from "@medusajs/medusa/core-flows"
import { MathBN } from "@medusajs/framework/utils"

/** Only fields used by the confirmation; never expose raw order metadata. */
export const ORDER_SUMMARY_FIELDS = [
  "id", "display_id", "status", "created_at", "currency_code", "item_subtotal",
  "item_tax_total", "shipping_total", "shipping_subtotal", "total", "metadata",
  "items.id", "items.title", "items.quantity", "items.unit_price", "items.thumbnail",
  "items.variant_id", "items.variant_title", "items.variant_sku", "items.subtotal",
  "items.discount_total", "items.discount_tax_total", "items.tax_total", "items.total",
  "shipping_address.first_name", "shipping_address.last_name", "shipping_address.address_1",
  "shipping_address.address_2", "shipping_address.province", "shipping_address.phone",
  "shipping_methods.name", "payment_collections.status", "payment_collections.amount",
  "payment_collections.captured_amount", "payment_collections.refunded_amount",
]

function image(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/** Undefined means a legacy order; null is a deliberately empty saved image. */
export function savedOrderImage(order: any, item: any): string | null | undefined {
  const images = order.metadata?.checkout_item_images
  if (images && typeof images === "object" && !Array.isArray(images) &&
    Object.prototype.hasOwnProperty.call(images, item.variant_id) &&
    (images[item.variant_id] === null || typeof images[item.variant_id] === "string")) {
    return image(images[item.variant_id])
  }
  return undefined
}

function maskPhone(value: unknown): string {
  const phone = typeof value === "string" ? value : ""
  if (phone.length <= 6) return "*".repeat(phone.length)
  return `${phone.slice(0, 3)}${"*".repeat(phone.length - 6)}${phone.slice(-3)}`
}

/** Catalog data supplies only legacy imagery, never historical order amounts. */
export function projectOrderSummary(order: any, legacyImages: Map<string, string | null>) {
  const items = (order.items ?? []).map((item: any) => {
    const snapshot = savedOrderImage(order, item)
    return {
      id: item.id, title: item.title, variant_title: item.variant_title ?? null,
      sku: item.variant_sku ?? null, quantity: Number(item.quantity), unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
      // Medusa's discount_total includes the tax saved by the discount. The
      // separate tax row is already net of that saving, so subtract it once.
      discount_total: Number(MathBN.sub(item.discount_total ?? 0, item.discount_tax_total ?? 0)),
      tax_total: Number(item.tax_total ?? 0), total: Number(item.total),
      thumbnail: snapshot !== undefined ? snapshot : legacyImages.get(item.variant_id) ?? image(item.thumbnail),
    }
  })
  const shippingTotal = Number(order.shipping_total)
  return {
    id: order.id, display_id: order.display_id, status: order.status ?? "unknown",
    created_at: order.created_at, currency_code: order.currency_code,
    subtotal: Number(order.item_subtotal),
    discount_total: Number(MathBN.sum(...items.map((item: any) => item.discount_total))),
    tax_total: Number(order.item_tax_total), shipping_total: shippingTotal,
    shipping_subtotal: Number(order.shipping_subtotal), total: Number(order.total),
    payment_method: "Cash on Delivery",
    payment_status: getLastPaymentStatus({ currency_code: order.currency_code,
      payment_collections: order.payment_collections ?? [] } as any),
    free_shipping: shippingTotal === 0,
    items, shipping_method: order.shipping_methods?.[0]?.name ?? null,
    delivery: {
      name: [order.shipping_address?.first_name, order.shipping_address?.last_name].filter(Boolean).join(" "),
      address: order.shipping_address?.address_1 ?? "", area: order.shipping_address?.address_2 ?? "",
      district: order.shipping_address?.province ?? "", phone: maskPhone(order.shipping_address?.phone),
    },
  }
}
