import type { MedusaContainer } from "@medusajs/framework/types"

import {
  catalogFingerprint,
  feedDue,
  type FeedBuildState,
  publishFeed,
  variantIndexDue,
} from "../lib/tracking/catalog-feed"
import { convertPending, imageBatchLimit } from "../lib/tracking/catalog-images"
import { getState, trackingDb } from "../lib/tracking/db"
import { registerTrackingJob, runTrackingJob } from "../lib/tracking/jobs"
import { loadTrackingSettings } from "../lib/tracking/settings"
import { rebuildVariantIndex, type VariantIndexState } from "../lib/tracking/variant-index"

/**
 * Every 15 minutes (TRACKING.md 6.4, 8): keeps the variant index fresh (when
 * it is empty, a product or stock change came in, or it is a day old), even
 * while the catalog feed is off, because ingest prices events from it. With
 * the catalog on, it then makes pending JPEG copies of feed images and
 * rebuilds the feed when something changed or the daily 03:30 Dhaka rebuild
 * is due. Registered with the tracking jobs registry, so admin and ingest
 * requests re-run it in-process if its BullMQ schedule is lost.
 */
export async function runCatalogJob(container: any): Promise<void> {
  const db = trackingDb(container)
  const now = new Date(Date.now())
  const [index, stale] = await Promise.all([
    getState<VariantIndexState>(db, "variant_index"),
    getState<{ at: string }>(db, "catalog:stale"),
  ])
  if (variantIndexDue(index, stale?.at ?? null, now)) await rebuildVariantIndex(container)

  const { config } = await loadTrackingSettings(container)
  if (!config.catalog.enabled) return

  let converted = 0
  if (config.catalog.image_mode === "jpeg_copies") {
    const images = await convertPending(container, { limit: imageBatchLimit(now) })
    converted = images.converted
  }

  const build = await getState<FeedBuildState>(db, "catalog:build")
  if (feedDue({ now, build, staleAt: stale?.at ?? null, configFp: catalogFingerprint(config.catalog), imagesConverted: converted })) {
    await publishFeed(container)
  }
}

registerTrackingJob("catalog", { staleAfterMs: 2_700_000, run: runCatalogJob })

export default async function catalogFeedJob(container: MedusaContainer) {
  await runTrackingJob(container, "catalog", runCatalogJob)
}

export const config = {
  name: "catalog-feed",
  schedule: { interval: 900_000 },
}
