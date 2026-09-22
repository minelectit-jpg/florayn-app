import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { saveManagedVariantsWorkflow } from "../../../../../workflows/product-manager"

export const AUTHENTICATE = true
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req.body ?? {}) as { variants?: any[] }
    const { result } = await saveManagedVariantsWorkflow(req.scope).run({ input: { productId: req.params.id, variants: body.variants ?? [] } })
    res.json(result)
  } catch (error: any) {
    res.status(400).json({ message: error?.message || "Could not save variants." })
  }
}
