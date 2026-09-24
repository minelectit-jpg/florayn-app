import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { readReviewToken } from "./review-links"

export type InviteProduct = { id: string; handle: string; title: string; thumbnail: string | null; design: string | null }

export type ReviewInvite = {
  orderId: string
  displayId: number | null
  email: string | null
  customerId: string | null
  firstName: string | null
  fullName: string | null
  /** The order's published products, one per design, in order. */
  products: InviteProduct[]
}

/** The review key a product's reviews are pooled under (see product-reviews.ts). */
export const designKey = (p: { id: string; design: string | null }) => (p.design ? `design:${p.design}` : `product:${p.id}`)

/** An order's reviewable products and customer, for its request email and review link. */
export async function loadInvite(container: any, orderId: string): Promise<ReviewInvite | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id", "display_id", "email", "customer_id",
      "shipping_address.first_name", "shipping_address.last_name",
      "billing_address.first_name", "billing_address.last_name",
      "items.product_id", "items.thumbnail",
      "items.product.id", "items.product.handle", "items.product.title", "items.product.status", "items.product.thumbnail", "items.product.metadata",
    ],
    filters: { id: orderId },
  })
  const order: any = data?.[0]
  if (!order) return null
  const address = order.shipping_address ?? order.billing_address ?? {}
  const seen = new Set<string>()
  const products: InviteProduct[] = []
  for (const item of order.items ?? []) {
    const p = item.product
    if (!p || p.status !== "published") continue
    const product = {
      id: p.id,
      handle: p.handle,
      title: (p.metadata?.design_name as string) || p.title,
      thumbnail: item.thumbnail ?? p.thumbnail ?? null,
      design: typeof p.metadata?.design_slug === "string" ? p.metadata.design_slug : null,
    }
    const key = designKey(product)
    if (seen.has(key)) continue
    seen.add(key)
    products.push(product)
  }
  const first = typeof address.first_name === "string" ? address.first_name.trim() : ""
  const last = typeof address.last_name === "string" ? address.last_name.trim() : ""
  return {
    orderId: order.id,
    displayId: order.display_id ?? null,
    email: order.email ?? null,
    customerId: order.customer_id ?? null,
    firstName: first || null,
    fullName: [first, last].filter(Boolean).join(" ") || null,
    products,
  }
}

/** The invite behind a review link, or null when the link is forged or its order gone. */
export async function inviteFromToken(container: any, token: unknown): Promise<ReviewInvite | null> {
  const orderId = readReviewToken(token)
  return orderId ? loadInvite(container, orderId) : null
}
