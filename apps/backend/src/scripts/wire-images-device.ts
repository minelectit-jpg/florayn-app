import { Modules } from "@medusajs/framework/utils"
import fs from "node:fs"

/**
 * Point every variant at the renders for its own device.
 *
 * Each variant carries its ordered gallery in `metadata.images`, so a shopper
 * picking iPhone 12 sees the iPhone 12 render rather than a stand-in for the
 * whole phone family. The product keeps a flattened `images[]` so the admin
 * product page still shows thumbnails.
 *
 * The base URL is read from IMAGE_BASE_URL - the one place the host is named.
 *
 *   npx medusa exec ./src/scripts/wire-images-device.ts
 */
export default async function wireImagesDevice({ container }: any) {
  const logger = container.resolve("logger")
  const productModule = container.resolve(Modules.PRODUCT)

  const base = (process.env.IMAGE_BASE_URL ?? "").replace(/\/+$/, "")
  const manifestPath =
    process.env.IMAGE_MANIFEST_DEVICE ??
    "C:/Users/Md Shamim/florayn-images-device/manifest.json"

  if (!base) throw new Error("IMAGE_BASE_URL is not set (apps/backend/.env)")
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  const entries = Object.values(manifest.products) as any[]
  logger.info(`Wiring ${entries.length} products at device granularity`)

  const products = await productModule.listProducts(
    {},
    { select: ["id", "handle", "metadata"], relations: ["variants"], take: 2000 }
  )
  const byPair = new Map<string, any>()
  for (const product of products) {
    const design = product.metadata?.design_slug
    const caseType = product.metadata?.case_type_slug
    if (design && caseType) byPair.set(`${design}|${caseType}`, product)
  }

  // Variant title is the device name; the manifest is keyed by device slug.
  const devices = await container
    .resolve("catalog")
    .listDevices({}, { select: ["slug", "name"] })
  const slugByName = new Map<string, string>(
    devices.map((d: any) => [d.name, d.slug])
  )

  let wiredProducts = 0
  let wiredVariants = 0
  let missingVariants = 0
  let urls = 0

  for (const entry of entries) {
    const product = byPair.get(`${entry.design}|${entry.case_type}`)
    if (!product) continue

    const byDevice = entry.images as Record<string, string[]>
    const variantUpdates: { id: string; metadata: Record<string, unknown> }[] = []
    const flattened: string[] = []

    for (const variant of product.variants ?? []) {
      const slug = slugByName.get(variant.title)
      const paths = slug ? byDevice[slug] : undefined
      if (!paths?.length) { missingVariants++; continue }
      const full = paths.map((p) => `${base}/${p}`)
      urls += full.length
      flattened.push(...full)
      variantUpdates.push({
        id: variant.id,
        metadata: { ...(variant.metadata ?? {}), images: full, device_slug: slug },
      })
    }

    if (!variantUpdates.length) continue

    for (const update of variantUpdates) {
      await productModule.updateProductVariants(update.id, {
        metadata: update.metadata,
      })
      wiredVariants++
    }

    // Unique, order preserved - the admin gallery only needs each shot once.
    const unique = [...new Set(flattened)]
    await productModule.updateProducts(product.id, {
      images: unique.map((url) => ({ url })),
      thumbnail: unique[0],
      metadata: { ...(product.metadata ?? {}), image_granularity: "device" },
    })
    wiredProducts++
    if (wiredProducts % 50 === 0) {
      logger.info(`  ${wiredProducts}/${entries.length} products, ${wiredVariants} variants`)
    }
  }

  logger.info(
    `Done. ${wiredProducts} products, ${wiredVariants} variants, ${urls} URLs, ` +
      `${missingVariants} variants with no render.`
  )
}
