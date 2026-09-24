import { model } from "@medusajs/framework/utils"

/**
 * One order brought over from another shop (florayn.com's WooCommerce), and
 * the Medusa order it became. Keyed by the source's own order id, so running
 * the import again updates statuses instead of adding a second copy.
 */
const ImportedOrder = model
  .define("imported_order", {
    id: model.id({ prefix: "impo" }).primaryKey(),
    /** Where it came from, e.g. "florayn.com". */
    source: model.text(),
    /** The WooCommerce order id. */
    source_id: model.text(),
    /** The Medusa order it became. */
    order_id: model.text(),
    /** The WooCommerce status at the last import, e.g. "completed". */
    source_status: model.text().nullable(),
    /** WooCommerce's date_modified at the last import. */
    source_modified_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["source", "source_id"], unique: true },
    { on: ["order_id"] },
  ])

export default ImportedOrder
