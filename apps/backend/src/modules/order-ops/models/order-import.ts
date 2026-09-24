import { model } from "@medusajs/framework/utils"

/**
 * The florayn.com order import (Order Manager > Import from florayn.com): the
 * WooCommerce REST API key it reads with, and the progress of the last run.
 * A single row. The key's secret is only ever returned masked.
 */
const OrderImport = model.define("order_import", {
  id: model.id({ prefix: "oimp" }).primaryKey(),
  site_url: model.text().default("https://florayn.com"),
  /** WooCommerce REST API consumer key (ck_…), Read permission is enough. */
  consumer_key: model.text().nullable(),
  /** WooCommerce REST API consumer secret (cs_…). */
  consumer_secret: model.text().nullable(),
  /** idle | running | done | failed */
  state: model.text().default("idle"),
  /** { total, seen, created, updated, unchanged, skipped, failed, mismatched, errors: [{ id, message }] } */
  progress: model.json().nullable(),
  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
})

export default OrderImport
