import { model } from "@medusajs/framework/utils"

/**
 * The WhatsApp Business (Meta Cloud API) connection, a single row edited from
 * Admin > Reviews > WhatsApp. Like the Steadfast keys, the access token lives
 * here so it can be rotated without a deploy, and the admin API only ever
 * returns it masked.
 */
const WhatsAppSettings = model.define("whatsapp_settings", {
  id: model.id({ prefix: "wa" }).primaryKey(),
  /** Nothing is sent over WhatsApp while this is off. */
  enabled: model.boolean().default(false),
  /** The sending number's "Phone number ID" (WhatsApp Manager > API Setup). */
  phone_number_id: model.text().nullable(),
  /** The WhatsApp Business Account ID, which owns the message templates. */
  business_account_id: model.text().nullable(),
  /** A permanent System User access token with whatsapp_business_messaging. */
  access_token: model.text().nullable(),
  /** Graph API version the requests use. */
  api_version: model.text().default("v23.0"),
})

export default WhatsAppSettings
