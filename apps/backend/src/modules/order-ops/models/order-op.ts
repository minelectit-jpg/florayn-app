import { model } from "@medusajs/framework/utils"

/**
 * Operational state for one Medusa order that the native order does not track:
 * where it sits in the fulfilment workflow (the admin tabs) and its Steadfast
 * courier consignment. One row per order, created lazily the first time the
 * order manager sees an order without one (default `processing`).
 *
 * `workflow_status` is the source of truth for the tabs. It is advanced by the
 * merchant (processing -> confirmed), by sending to the courier (-> shipped),
 * and by syncing Steadfast's delivery status (-> delivered / returned).
 */
const OrderOp = model
  .define("order_op", {
    id: model.id({ prefix: "oop" }).primaryKey(),
    /** The Medusa order this row shadows. */
    order_id: model.text(),
    /** processing | confirmed | shipped | delivered | returned | refunded | cancelled */
    workflow_status: model.text().default("processing"),
    /** Steadfast consignment id, once the order has been sent to the courier. */
    steadfast_consignment_id: model.text().nullable(),
    /** Steadfast tracking code (also what the printed label's barcode encodes). */
    steadfast_tracking_code: model.text().nullable(),
    /** The last raw Steadfast delivery_status seen for this consignment. */
    steadfast_status: model.text().nullable(),
    /** When the Steadfast status was last synced. */
    steadfast_synced_at: model.dateTime().nullable(),
    /** When a shipping label was last printed for this order. */
    label_printed_at: model.dateTime().nullable(),
    /** Internal merchant note on the order (not shown to the customer). */
    note: model.text().nullable(),
  })
  .indexes([
    { on: ["order_id"], unique: true },
    { on: ["workflow_status"] },
  ])

export default OrderOp
