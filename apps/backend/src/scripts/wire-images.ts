import { Modules } from "@medusajs/framework/utils"
import fs from "node:fs"

/**
 * Point every product at its images on R2.
 *
 * The base URL is read from IMAGE_BASE_URL and written into the product rows,
 * so it lives in exactly one place: the backend .env. Swapping r2.dev for
 * img.florayn.com is a change to that variable and one rerun of this script -
 * nothing in the codebase names a host.
 *
 *   npx medusa exec ./src/scripts/wire-images.ts
 *
 * Reads the manifest produced by the image sweep. Each product gets:
 *   - images[]            every shot, so the admin has something to look at
 *   - thumbnail           the first phone shot, or the first of anything
 *   - metadata.images     family -> ordered URLs, which is what the storefront
 *                         gallery keys off when the shopper changes device
 */
export default async function wireImages({ container }: any) {
  const logger = container.resolve("logger")
  const productModule = container.resolve(Modules.PRODUCT)

  const base = (process.env.IMAGE_BASE_URL ?? "").replace(/\/+$/, "")
  const manifestPath =
    process.env.IMAGE_MANIFEST ??
    "C:/Users/Md Shamim/florayn-images/manifest.json"

  if (!base) {
    throw new Error(
      "IMAGE_BASE_URL is not set. Add it to apps/backend/.env - it is the one " +
        "place the image host is named."
    )
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}. Set IMAGE_MANIFEST.`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  const entries = Object.values(manifest.products) as any[]
  logger.info(`Wiring ${entries.length} products to ${base}`)

  // Products are keyed by design and case type in their metadata.
  const products = await productModule.listProducts(
    {},
    { select: ["id", "handle", "metadata"], take: 2000 }
  )
  const byPair = new Map<string, any>()
  for (const product of products) {
    const design = product.metadata?.design_slug
    const caseType = product.metadata?.case_type_slug
    if (design && caseType) byPair.set(`${design}|${caseType}`, product)
  }

  let wired = 0
  let unmatched = 0
  let urlCount = 0

  for (const entry of entries) {
    const key = `${entry.design}|${entry.case_type}`
    const product = byPair.get(key)
    if (!product) {
      unmatched++
      continue
    }

    // family -> absolute URLs, in manifest order.
    const byFamily: Record<string, string[]> = {}
    for (const [family, paths] of Object.entries(entry.images as Record<string, string[]>)) {
      byFamily[family] = paths.map((p) => `${base}/${p}`)
    }

    // Phone first when it exists; it is what the card shows.
    const ordered = [
      ...(byFamily.phone ?? []),
      ...Object.entries(byFamily)
        .filter(([family]) => family !== "phone")
        .flatMap(([, urls]) => urls),
    ]
    if (!ordered.length) {
      unmatched++
      continue
    }
    urlCount += ordered.length

    await productModule.updateProducts(product.id, {
      images: ordered.map((url) => ({ url })),
      thumbnail: ordered[0],
      metadata: { ...(product.metadata ?? {}), images: byFamily },
    })
    wired++
  }

  logger.info(
    `Done. ${wired} products wired, ${urlCount} image URLs, ${unmatched} unmatched.`
  )
}
