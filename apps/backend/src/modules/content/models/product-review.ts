import { model } from "@medusajs/framework/utils"

export default model.define("product_review", {
  id: model.id({ prefix: "review" }).primaryKey(),
  review_key: model.text(),
  product_id: model.text(),
  customer_id: model.text(),
  author: model.text(),
  rating: model.number(),
  title: model.text(),
  body: model.text(),
  status: model.enum(["pending", "approved", "rejected"]).default("pending"),
  reply: model.text().default(""),
  /** Customer photos (R2 URLs), in order. */
  images: model.json<string[]>().nullable(),
  /** Where the reward code is mailed: the order's or the account's email. */
  email: model.text().nullable(),
  /** The order's mobile (8801XXXXXXXXX): the code goes on WhatsApp when there is no email. */
  phone: model.text().nullable(),
  /** The order a review link came from; such a review is a verified purchase. */
  order_id: model.text().nullable(),
  verified: model.boolean().default(false),
  /** The discount code this review earned, and its size. */
  coupon_code: model.text().nullable(),
  reward_pct: model.number().nullable(),
  reward_issued_at: model.dateTime().nullable(),
  /** When the code reached the reviewer (by email or WhatsApp). */
  reward_mailed_at: model.dateTime().nullable(),
  /** How it went: "email" or "whatsapp". */
  reward_channel: model.text().nullable(),
  /** Why no code was issued (cooldown, rating, rewards off). */
  reward_note: model.text().nullable(),
}).indexes([
  { on: ["review_key", "customer_id"], unique: true },
  { on: ["review_key", "status"] },
])

