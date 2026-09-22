import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { readProductContent } from "../../../../../lib/product-content"
import { saveProductContentWorkflow } from "../../../../../workflows/save-product-content"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const product = await req.scope.resolve(Modules.PRODUCT).retrieveProduct(req.params.id, { select: ["id", "metadata"] })
  res.json({ settings: readProductContent(product.metadata) })
}
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await saveProductContentWorkflow(req.scope).run({ input: { productId: req.params.id, settings: req.body } })
  await GET(req, res)
}

