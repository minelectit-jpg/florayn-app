import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { CONTENT_MODULE } from "../../../modules/content"

/** GET /admin/review-rewards - the last 50 codes issued for reviews. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const content: any = req.scope.resolve(CONTENT_MODULE)
  const reviews = await content.listProductReviews({ coupon_code: { $ne: null } }, { take: 50, order: { reward_issued_at: "DESC" } })
  const productIds = [...new Set<string>(reviews.map((r: any) => r.product_id))]
  const products = productIds.length ? await req.scope.resolve(Modules.PRODUCT).listProducts({ id: productIds }, { select: ["id", "title", "metadata"], take: productIds.length }) : []
  const title = new Map<string, string>(products.map((p: any) => [p.id, (p.metadata?.design_name as string) || p.title]))
  res.json({
    rewards: reviews.map((r: any) => ({
      id: r.id, author: r.author, email: r.email, product: title.get(r.product_id) ?? r.product_id,
      code: r.coupon_code, pct: r.reward_pct, photos: Array.isArray(r.images) ? r.images.length : 0,
      issued_at: r.reward_issued_at, mailed: Boolean(r.reward_mailed_at),
    })),
  })
}
