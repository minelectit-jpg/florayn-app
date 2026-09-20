import { model } from "@medusajs/framework/utils"

import { DEFAULT_CHECKOUT_SETTINGS } from "../checkout-settings"

const CheckoutSetting = model.define("checkout_setting", {
  id: model.id({ prefix: "checkoutset" }).primaryKey(),
  heading: model.text().default(DEFAULT_CHECKOUT_SETTINGS.heading),
  description: model.text().default(DEFAULT_CHECKOUT_SETTINGS.description),
  delivery_note: model.text().default(DEFAULT_CHECKOUT_SETTINGS.delivery_note),
  support_phone: model.text().default(DEFAULT_CHECKOUT_SETTINGS.support_phone),
  support_label: model.text().default(DEFAULT_CHECKOUT_SETTINGS.support_label),
  show_order_note: model.boolean().default(DEFAULT_CHECKOUT_SETTINGS.show_order_note),
})

export default CheckoutSetting
