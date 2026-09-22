import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { addRegularVariantWorkflow } from "../../../../../workflows/product-manager"

export const AUTHENTICATE = true
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { result } = await addRegularVariantWorkflow(req.scope).run({ input: { productId: req.params.id, variant: req.body } })
    res.json(result)
  } catch (error: any) {
    res.status(400).json({ message: error?.message || "Could not add the variant." })
  }
}
