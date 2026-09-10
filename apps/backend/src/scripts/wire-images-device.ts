import { Modules } from "@medusajs/framework/utils"
import fs from "node:fs"
import path from "node:path"

/**
 * Where the device manifest might be, most explicit first.
 *
 * The old default was the absolute Windows path this was first written
 * against. On Linux that string has no leading slash, so it resolved relative
 * to the working directory as a folder literally named "C:" and failed with a
 * baffling "Manifest not found at C:/Users/..." on a machine that has no C
 * drive. The manifest now ships in the repository, but `medusa build` does not
 * copy apps/backend/data into .medusa/server, so a compiled run cannot reach
 * it relatively - which is why the one-shot wrapper passes
 * IMAGE_MANIFEST_DEVICE explicitly and this list is only a fallback.
 */
function resolveManifestPath(): string | null {
  const candidates = [
    process.env.IMAGE_MANIFEST_DEVICE,
    path.join(__dirname, "..", "..", "data", "images-device-manifest.json"),
    path.join(process.cwd(), "data", "images-device-manifest.json"),
    path.join(process.cwd(), "apps", "backend", "data", "images-device-manifest.json"),
  ].filter(Boolean) as string[]

  return candidates.find((file) => fs.existsSync(file)) ?? null
}

/** Host and database only - this goes to a log, and the password does not. */
function describeTargetDb(): string {
  const url = process.env.DATABASE_URL
  if (!url) return "(DATABASE_URL not set)"
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")} as ${u.username}`
  } catch {
    return "(unparseable DATABASE_URL)"
  }
}

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
  const manifestPath = resolveManifestPath()

  if (!base) throw new Error("IMAGE_BASE_URL is not set (apps/backend/.env)")
  if (!manifestPath) {
    throw new Error(
      "Device manifest not found. Set IMAGE_MANIFEST_DEVICE, or ship " +
        "apps/backend/data/images-device-manifest.json with the app."
    )
  }

  /*
   * A run against the wrong database is the failure mode with real cost here,
   * and it has already happened once on this project, so the target is stated
   * before anything is written rather than left to be inferred afterwards.
   */
  logger.info(`Target database: ${describeTargetDb()}`)
  logger.info(`Image host: ${base}`)
  logger.info(`Manifest: ${manifestPath}`)

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  let entries = Object.values(manifest.products) as any[]

  /*
   * WIRE_LIMIT exists so the first production run can be a handful of
   * products that a human looks at on the real site before the other 520 are
   * touched. Zero or unset means everything.
   */
  const limit = Number(process.env.WIRE_LIMIT ?? 0)
  if (limit > 0) {
    entries = entries.slice(0, limit)
    logger.info(`WIRE_LIMIT=${limit} - wiring only the first ${entries.length} products.`)
  }

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
