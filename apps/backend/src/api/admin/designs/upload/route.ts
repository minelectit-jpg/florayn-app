import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { slugify } from "../../../../lib/create-uploaded-design"

/**
 * POST /admin/designs/upload - store ONE uploaded mockup on R2 under a tidy,
 * predictable key and hand back its public URL. The New Design uploader calls
 * this once per file (base64 in JSON, so no multipart middleware is needed),
 * building up the design's image map before it creates the products.
 *
 * The key mirrors the folder layout the owner uploads:
 *   designs/<design>/<case-type>/<device>/<n>.<ext>
 * The S3 provider keeps that path and only appends a ULID to the file name, so
 * the bucket stays browsable while every object is still unique.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/webp": ".webp",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/avif": ".avif",
  "image/gif": ".gif",
}

function extFor(originalName: string | undefined, mimeType: string): string {
  const fromName = originalName?.match(/\.[a-z0-9]+$/i)?.[0]
  if (fromName) return fromName.toLowerCase()
  return EXT_BY_MIME[mimeType?.toLowerCase()] ?? ".webp"
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as {
    designSlug?: string
    caseTypeSlug?: string
    deviceSlug?: string
    index?: number
    filename?: string
    mimeType?: string
    contentBase64?: string
  }

  const designSlug = slugify(body.designSlug ?? "")
  const caseTypeSlug = slugify(body.caseTypeSlug ?? "")
  const deviceSlug = slugify(body.deviceSlug ?? "")
  const mimeType = body.mimeType || "image/webp"
  const content = body.contentBase64

  if (!designSlug || !caseTypeSlug || !deviceSlug) {
    res.status(400).json({
      message: "designSlug, caseTypeSlug and deviceSlug are required.",
    })
    return
  }
  if (!content) {
    res.status(400).json({ message: "contentBase64 is required." })
    return
  }

  const index = Number.isFinite(body.index) ? Number(body.index) : 1
  const ext = extFor(body.filename, mimeType)
  const key = `designs/${designSlug}/${caseTypeSlug}/${deviceSlug}/${index}${ext}`

  const fileModule = req.scope.resolve(Modules.FILE)
  try {
    const file = await fileModule.createFiles({
      filename: key,
      mimeType,
      content,
    })
    res.json({ url: file.url, key })
  } catch (error: any) {
    const logger = req.scope.resolve("logger")
    logger.error(`[design-upload] ${error?.message ?? error}`)
    res.status(500).json({ message: error?.message ?? "Upload failed." })
  }
}
