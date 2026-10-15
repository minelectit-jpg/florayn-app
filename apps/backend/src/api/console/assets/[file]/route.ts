import fs from "node:fs"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { consoleAsset } from "../../../../lib/console-files"

/** GET /console/assets/:file - the console's built scripts and styles (hashed names, cached for a year). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const asset = consoleAsset(String(req.params.file ?? ""))
  if (!asset || !fs.existsSync(asset.file)) {
    res.status(404).end()
    return
  }
  res.setHeader("content-type", asset.type)
  res.setHeader("cache-control", "public, max-age=31536000, immutable")
  res.setHeader("x-content-type-options", "nosniff")
  fs.createReadStream(asset.file).pipe(res)
}
