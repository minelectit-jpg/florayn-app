import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readBundleBadge } from "../../../../lib/bundle-badge"
import { saveBundleBadgeWorkflow } from "../../../../workflows/save-bundle-badge"
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { text } = await readBundleBadge(req.scope)
  res.json({ text })
}
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await saveBundleBadgeWorkflow(req.scope).run({ input: { text: (req.body as any)?.text } })
  await GET(req, res)
}
