import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { opsByOrderId, DEFAULT_STATUS, type WorkflowStatus } from "../../../../lib/order-ops"

const DETAIL_FIELDS = [
  "id",
  "display_id",
  "status",
  "created_at",
  "email",
  "currency_code",
  "total",
  "item_subtotal",
  "shipping_total",
  "metadata",
  "items.title",
  "items.quantity",
  "items.unit_price",
  "items.thumbnail",
  "items.variant_id",
  "items.variant_title",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.province",
  "shipping_address.phone",
]

function savedImage(order: any, variantId: string): string | null | undefined {
  const images = order.metadata?.checkout_item_images
  if (images && typeof images === "object" && !Array.isArray(images) &&
    Object.prototype.hasOwnProperty.call(images, variantId)) {
    const v = images[variantId]
    return typeof v === "string" && v.trim() ? v : null
  }
  return undefined
}

/** GET /admin/order-ops/:orderId - full order + courier detail for the drawer. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.orderId
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: DETAIL_FIELDS,
    filters: { id: orderId },
  })
  const order = orders?.[0]
  if (!order) return res.status(404).json({ message: "Order not found." })

  const op = (await opsByOrderId(req.scope, [orderId])).get(orderId)
  const addr: any = order.shipping_address ?? {}
  const meta: any = order.metadata ?? {}

  return res.json({
    order: {
      order_id: order.id,
      display_id: order.display_id,
      created_at: order.created_at,
      email: order.email,
      currency_code: order.currency_code ?? "bdt",
      subtotal: Number(order.item_subtotal ?? 0),
      shipping_total: Number(order.shipping_total ?? 0),
      total: Number(order.total ?? 0),
      note: (meta.order_note as string) ?? null,
      customer_name: [addr.first_name, addr.last_name].filter(Boolean).join(" ").trim(),
      phone: addr.phone ?? (meta.customer_phone as string) ?? "",
      address_1: addr.address_1 ?? "",
      area: addr.address_2 ?? (meta.area as string) ?? "",
      district: addr.province ?? (meta.district as string) ?? "",
      items: (order.items ?? []).map((i: any) => {
        const snap = savedImage(order, i.variant_id)
        return {
          title: i.title,
          variant_title: i.variant_title ?? null,
          quantity: Number(i.quantity ?? 0),
          unit_price: Number(i.unit_price ?? 0),
          thumbnail: snap !== undefined ? snap : (typeof i.thumbnail === "string" ? i.thumbnail : null),
        }
      }),
      workflow_status: (op?.workflow_status ?? DEFAULT_STATUS) as WorkflowStatus,
      steadfast_consignment_id: op?.steadfast_consignment_id ?? null,
      steadfast_tracking_code: op?.steadfast_tracking_code ?? null,
      steadfast_status: op?.steadfast_status ?? null,
      steadfast_synced_at: op?.steadfast_synced_at ?? null,
      steadfast_charge: (op as any)?.courier_meta?.charge ?? null,
      tracking_message: (op as any)?.courier_meta?.tracking_message ?? null,
      label_printed_at: op?.label_printed_at ?? null,
    },
  })
}
