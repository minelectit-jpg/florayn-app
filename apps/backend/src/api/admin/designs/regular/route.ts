import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createRegularProductWorkflow } from "../../../../workflows/product-manager"

export const AUTHENTICATE = true
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { result } = await createRegularProductWorkflow(req.scope).run({ input: req.body as Record<string, unknown> })
    res.json({ result })
  } catch (error: any) {
    res.status(400).json({ message: error?.message || "Could not create the product." })
  }
}
