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
}).indexes([
  { on: ["review_key", "customer_id"], unique: true },
  { on: ["review_key", "status"] },
])

