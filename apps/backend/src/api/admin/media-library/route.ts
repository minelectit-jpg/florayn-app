import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import fs from "node:fs"

import {
  DEFAULT_IMAGE_BASE_URL,
  resolveManifestPath,
} from "../../../lib/wire-images-device"

/**
 * GET /admin/media-library - a folder-by-folder view of every render in R2,
 * built from the device image manifest (design -> case type -> device -> URLs).
 * Covers all swept artwork, even for designs not yet imported, so it doubles as
 * the picture library the New Design tool draws from.
 *
 *   GET /admin/media-library            -> the designs (top-level folders)
 *   GET /admin/media-library?design=x   -> that design's case types + devices
 */
type Tree = {
  byDesign: Record<string, Record<string, Record<string, string[]>>>
  base: string
}
let cache: Tree | null = null

function load(): Tree | null {
  if (cache) return cache
  const p = resolveManifestPath()
  if (!p) return null
  const m = JSON.parse(fs.readFileSync(p, "utf8"))
  const base = (m.base_url ?? DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, "")
  const byDesign: Tree["byDesign"] = {}
  for (const entry of Object.values(m.products) as any[]) {
    const d = entry.design as string
    const ct = entry.case_type as string
    ;(byDesign[d] ??= {})[ct] = {}
    for (const [dev, paths] of Object.entries(entry.images ?? {})) {
      byDesign[d][ct][dev] = (paths as string[]).map((pth) => `${base}/${pth}`)
    }
  }
  cache = { byDesign, base }
  return cache
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = load()
  if (!data) {
    res.status(404).json({ message: "Image manifest not found on this host." })
    return
  }

  const design = (req.query.design as string | undefined)?.trim()
  if (design) {
    res.json({ design, caseTypes: data.byDesign[design] ?? {} })
    return
  }

  const designs = Object.keys(data.byDesign)
    .sort()
    .map((slug) => {
      const cts = data.byDesign[slug]
      const firstCt = Object.keys(cts)[0]
      const firstDev = firstCt ? Object.keys(cts[firstCt])[0] : null
      const sample = firstDev ? cts[firstCt][firstDev][0] : null
      let images = 0
      for (const ct of Object.values(cts)) {
        for (const urls of Object.values(ct)) images += urls.length
      }
      return { slug, caseTypes: Object.keys(cts), images, sample }
    })

  res.json({ designs, count: designs.length })
}
