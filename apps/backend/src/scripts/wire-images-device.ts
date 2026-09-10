import {
  DEFAULT_IMAGE_BASE_URL,
  wireImagesDevice,
} from "../lib/wire-images-device"

/**
 * Wire device-level image URLs from the command line.
 *
 *   npx medusa exec ./src/scripts/wire-images-device.ts
 *
 * The real logic lives in ../lib/wire-images-device so the admin route can
 * share it. WIRE_LIMIT wires only the first N products for a test batch.
 */
export default async function wireImagesDeviceScript({ container }: any) {
  const logger = container.resolve("logger")
  const limit = Number(process.env.WIRE_LIMIT ?? 0)
  const baseUrl = process.env.IMAGE_BASE_URL ?? DEFAULT_IMAGE_BASE_URL

  logger.info(`Wiring images (limit ${limit || "none"}) from ${baseUrl}`)

  const result = await wireImagesDevice({
    container,
    limit,
    baseUrl,
    manifestPath: process.env.IMAGE_MANIFEST_DEVICE,
    onProgress: (m) => logger.info(`  ${m}`),
  })

  logger.info(
    `Done. ${result.products} products, ${result.variants} variants, ` +
      `${result.urls} URLs, ${result.missingVariants} variants with no render ` +
      `(manifest ${result.manifestPath}).`
  )
}
