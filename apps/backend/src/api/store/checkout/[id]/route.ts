import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The order-confirmation payload.
 *
 * The stock Store API only returns an order to the customer it belongs to, and
 * these are guest orders, so the confirmation page reads it here instead. It is
 * addressed by the order's unguessable id - never by the human-readable
 * display_id - and returns only what the confirmation page prints. The
 * customer's phone is echoed back partly masked so someone with the link
 * cannot harvest it.
 *
 * GET /store/checkout/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { id } = req.params

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "created_at",
      "currency_code",
      "subtotal",
      "shipping_total",
      "total",
      "metadata",
      "items.id",
      "items.title",
      "items.subtitle",
      "items.quantity",
      "items.unit_price",
      "items.thumbnail",
      "items.variant_title",
      "items.variant_sku",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.address_1",
      "shipping_address.address_2",
      "shipping_address.city",
      "shipping_address.province",
      "shipping_address.phone",
      "shipping_methods.name",
      "shipping_methods.amount",
    ],
    filters: { id },
  })

  const order = orders?.[0]

  if (!order) {
    return res.status(404).json({ message: "Order not found" })
  }

  const phone: string = order.shipping_address?.phone ?? ""
  const maskedPhone = phone
    ? `${phone.slice(0, 3)}${"*".repeat(Math.max(0, phone.length - 6))}${phone.slice(-3)}`
    : ""

  res.json({
    order: {
      id: order.id,
      display_id: order.display_id,
      created_at: order.created_at,
      currency_code: order.currency_code,
      subtotal: order.subtotal,
      shipping_total: order.shipping_total,
      total: order.total,
      payment_method: "Cash on Delivery",
      free_shipping: Boolean((order.metadata as any)?.free_shipping),
      items: (order.items ?? []).map((item: any) => ({
        id: item.id,
        title: item.title,
        variant_title: item.variant_title,
        sku: item.variant_sku,
        quantity: item.quantity,
        unit_price: item.unit_price,
        thumbnail: item.thumbnail,
      })),
      shipping_method: order.shipping_methods?.[0]?.name ?? null,
      delivery: {
        name: [
          order.shipping_address?.first_name,
          order.shipping_address?.last_name,
        ]
          .filter(Boolean)
          .join(" "),
        address: order.shipping_address?.address_1 ?? "",
        area: order.shipping_address?.address_2 ?? "",
        district: order.shipping_address?.province ?? "",
        phone: maskedPhone,
      },
    },
  })
}
