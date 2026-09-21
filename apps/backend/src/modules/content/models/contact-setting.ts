import { model } from "@medusajs/framework/utils"
import { DEFAULT_CONTACT_SETTINGS as defaults, type ContactFaq } from "../contact-settings"

const ContactSetting = model.define("contact_setting", {
  id: model.id({ prefix: "contactset" }).primaryKey(),
  eyebrow: model.text().default(defaults.eyebrow),
  title: model.text().default(defaults.title),
  description: model.text().default(defaults.description),
  phone_label: model.text().default(defaults.phone_label),
  phone: model.text().default(defaults.phone),
  phone_note: model.text().default(defaults.phone_note),
  email_label: model.text().default(defaults.email_label),
  email: model.text().default(defaults.email),
  email_note: model.text().default(defaults.email_note),
  address_label: model.text().default(defaults.address_label),
  address: model.text().default(defaults.address),
  address_note: model.text().default(defaults.address_note),
  faq_eyebrow: model.text().default(defaults.faq_eyebrow),
  faq_title: model.text().default(defaults.faq_title),
  faq_description: model.text().default(defaults.faq_description),
  help_title: model.text().default(defaults.help_title),
  help_description: model.text().default(defaults.help_description),
  faqs: model.json<ContactFaq[]>().default(defaults.faqs),
})

export default ContactSetting
