import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { putObject } from "../../../../lib/r2"

/**
 * POST /admin/r2/upload - store ONE file at an exact key in R2 (base64 in JSON,
 * so no multipart middleware). The File Manager sends the key as
 * <current prefix>/<the file's path>, so uploading a folder preserves its
 * structure. The bucket becomes the owner's FileBird, on R2.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as {
    key?: string
    mimeType?: string
    contentBase64?: string
  }
  if (!body.key) {
    res.status(400).json({ message: "key is required." })
    return
  }
  if (!body.contentBase64) {
    res.status(400).json({ message: "contentBase64 is required." })
    return
  }
  try {
    const buffer = Buffer.from(body.contentBase64, "base64")
    const result = await putObject(
      body.key,
      buffer,
      body.mimeType || "application/octet-stream"
    )
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Upload failed." })
  }
}
