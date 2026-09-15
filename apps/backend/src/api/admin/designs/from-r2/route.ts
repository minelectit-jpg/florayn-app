import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { createUploadedDesign } from "../../../../lib/create-uploaded-design"
import { analyzeKeys } from "../../../../lib/folder-parse"
import { listAllUnder, r2PublicUrl } from "../../../../lib/r2"

/**
 * Build design product(s) from images ALREADY on R2 (uploaded via the File
 * Manager) - no re-upload from the computer.
 *
 *   GET  /admin/designs/from-r2?prefix=Florayn Garage/Phone Case
 *        -> preview: which designs / case types / image counts were found.
 *   POST /admin/designs/from-r2 { prefix, theme?, blankStock? }
 *        -> create every design found under the prefix.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const prefix = (req.query.prefix as string | undefined)?.trim()
  if (!prefix) {
    res.status(400).json({ message: "prefix is required." })
    return
  }
  try {
    const keys = await listAllUnder(prefix)
    const analysis = analyzeKeys(keys, r2PublicUrl)
    res.json({
      prefix,
      totalFiles: keys.length,
      designs: analysis.designs,
      skipped: analysis.skipped,
      unmatchedCases: analysis.unmatchedCases,
      unmatchedDevices: analysis.unmatchedDevices,
    })
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Could not read the folder." })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as {
    prefix?: string
    theme?: string | null
    blankStock?: number
  }
  const prefix = body.prefix?.trim()
  if (!prefix) {
    res.status(400).json({ message: "prefix is required." })
    return
  }
  const logger = req.scope.resolve("logger")
  try {
    const keys = await listAllUnder(prefix)
    const analysis = analyzeKeys(keys, r2PublicUrl)
    if (!analysis.designs.length) {
      res.status(400).json({
        message: "No designs could be read from that folder. Check the layout.",
        skipped: analysis.skipped,
        unmatchedCases: analysis.unmatchedCases,
        unmatchedDevices: analysis.unmatchedDevices,
      })
      return
    }

    const blankStock = Number.isFinite(body.blankStock) ? Number(body.blankStock) : 10
    const created: string[] = []
    const existed: string[] = []
    const failed: { name: string; message: string }[] = []

    for (const design of analysis.designs) {
      const pairs = analysis.pairsByDesign[design.name]
      try {
        await createUploadedDesign({
          container: req.scope,
          name: design.name,
          slug: design.slug,
          theme: body.theme ?? null,
          blankStock,
          pairs,
        })
        created.push(design.name)
      } catch (error: any) {
        const message = error?.message ?? String(error)
        if (/already exists|already in the store/i.test(message)) existed.push(design.name)
        else failed.push({ name: design.name, message })
      }
    }

    res.json({
      ok: true,
      created,
      existed,
      failed,
      skipped: analysis.skipped,
      unmatchedCases: analysis.unmatchedCases,
      unmatchedDevices: analysis.unmatchedDevices,
    })
  } catch (error: any) {
    logger.error(`[designs/from-r2] ${error?.message ?? error}`)
    res.status(400).json({ ok: false, message: error?.message ?? String(error) })
  }
}
