import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import fs from "node:fs"
import path from "node:path"

/**
 * Point every variant at the renders for its own device.
 *
 * The logic lives here rather than in the CLI script because it has to be
 * callable two ways: `medusa exec` on a machine with a shell, and an
 * admin-authenticated HTTP route on a host that has neither SSH nor working
 * environment-variable injection. The route is the one that matters in
 * production - it runs inside the web process, which is already connected to
 * the right database, so there is no connection string to supply and nothing
 * to point at the wrong catalogue.
 */

/** The public image host. Safe as a default: it is in every image URL already. */
export const DEFAULT_IMAGE_BASE_URL =
  "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"

/**
 * Where the device manifest might be.
 *
 * `medusa build` does not copy apps/backend/data into .medusa/server, but the
 * bundle sits INSIDE the repository checkout, so from the running server's cwd
 * the manifest is two levels up. That is what makes this work on a host where
 * only the repo was deployed.
 */
export function resolveManifestPath(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.IMAGE_MANIFEST_DEVICE,
    // cwd is apps/backend/.medusa/server when the server runs
    path.join(process.cwd(), "..", "..", "data", "images-device-manifest.json"),
    path.join(process.cwd(), "data", "images-device-manifest.json"),
    path.join(process.cwd(), "apps", "backend", "data", "images-device-manifest.json"),
    path.join(__dirname, "..", "..", "data", "images-device-manifest.json"),
  ].filter(Boolean) as string[]

  return candidates.find((file) => fs.existsSync(file)) ?? null
}

export type WireResult = {
  products: number
  variants: number
  urls: number
  missingVariants: number
  skippedProducts: number
  manifestPath: string
  baseUrl: string
}

export async function wireImagesDevice({
  container,
  limit = 0,
  baseUrl,
  manifestPath,
  onProgress,
}: {
  container: any
  limit?: number
  baseUrl?: string
  manifestPath?: string
  onProgress?: (message: string) => void
}): Promise<WireResult> {
  const productModule = container.resolve(Modules.PRODUCT)

  const base = (baseUrl ?? process.env.IMAGE_BASE_URL ?? DEFAULT_IMAGE_BASE_URL).replace(
    /\/+$/,
    ""
  )
  const resolved = resolveManifestPath(manifestPath)
  if (!resolved) {
    throw new Error(
      "Device manifest not found. It ships at apps/backend/data/" +
        "images-device-manifest.json - has the app been redeployed since it was added?"
    )
  }

  const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"))
  let entries = Object.values(manifest.products) as any[]
  if (limit > 0) entries = entries.slice(0, limit)

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
  const slugByName = new Map<string, string>(devices.map((d: any) => [d.name, d.slug]))

  let wiredProducts = 0
  let wiredVariants = 0
  let missingVariants = 0
  let skippedProducts = 0
  let urls = 0

  for (const entry of entries) {
    const product = byPair.get(`${entry.design}|${entry.case_type}`)
    if (!product) {
      skippedProducts++
      continue
    }

    const byDevice = entry.images as Record<string, string[]>
    const variantUpdates: { id: string; metadata: Record<string, unknown> }[] = []
    const flattened: string[] = []

    for (const variant of product.variants ?? []) {
      const slug = slugByName.get(variant.title)
      const paths = slug ? byDevice[slug] : undefined
      if (!paths?.length) {
        missingVariants++
        continue
      }
      const full = paths.map((p) => `${base}/${p}`)
      urls += full.length
      flattened.push(...full)
      variantUpdates.push({
        id: variant.id,
        metadata: { ...(variant.metadata ?? {}), images: full, device_slug: slug },
      })
    }

    if (!variantUpdates.length) {
      skippedProducts++
      continue
    }

    for (const update of variantUpdates) {
      await productModule.updateProductVariants(update.id, { metadata: update.metadata })
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

    if (onProgress && wiredProducts % 50 === 0) {
      onProgress(`${wiredProducts}/${entries.length} products, ${wiredVariants} variants`)
    }
  }

  return {
    products: wiredProducts,
    variants: wiredVariants,
    urls,
    missingVariants,
    skippedProducts,
    manifestPath: resolved,
    baseUrl: base,
  }
}

/** How far the wiring has got, counted from the database rather than inferred. */
export async function imageWiringStatus(container: any) {
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { rows } = await knex.raw(
    `SELECT count(*) FILTER (WHERE thumbnail LIKE 'http%')  AS wired,
            count(*) FILTER (WHERE thumbnail LIKE 'data:%') AS placeholder,
            count(*) FILTER (WHERE thumbnail IS NULL)       AS missing,
            count(*)                                        AS total,
            (SELECT count(*) FROM product_variant WHERE metadata ? 'images')
              AS variants_with_images,
            (SELECT count(*) FROM product_variant)          AS variants_total
       FROM product`
  )
  const r = rows[0] ?? {}
  return {
    wired: Number(r.wired ?? 0),
    placeholder: Number(r.placeholder ?? 0),
    missing: Number(r.missing ?? 0),
    total: Number(r.total ?? 0),
    variants_with_images: Number(r.variants_with_images ?? 0),
    variants_total: Number(r.variants_total ?? 0),
  }
}
