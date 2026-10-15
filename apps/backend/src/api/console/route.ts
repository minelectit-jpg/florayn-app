import fs from "node:fs"
import path from "node:path"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { consoleDir } from "../../lib/console-files"

/**
 * GET /console - Florayn Console (CONSOLE.md), our own admin. This serves only
 * the page shell; the app signs in and calls /admin/* with the admin session,
 * so it has exactly the classic admin's permissions.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  const file = path.join(consoleDir(), "index.html")
  if (!fs.existsSync(file)) {
    res.status(404).send("Florayn Console is not built. Run npm run build:console in apps/backend.")
    return
  }
  res.setHeader("content-type", "text/html; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.setHeader("x-frame-options", "DENY")
  res.setHeader("x-content-type-options", "nosniff")
  res.setHeader("x-robots-tag", "noindex, nofollow")
  res.send(fs.readFileSync(file, "utf8"))
}
