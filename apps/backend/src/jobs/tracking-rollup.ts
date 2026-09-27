import type { MedusaContainer } from "@medusajs/framework/types"

import { registerTrackingJob, runTrackingJob } from "../lib/tracking/jobs"
import { runRollup } from "../lib/tracking/rollup"

/**
 * Every minute: fold the closed minutes of raw tracking hits into the Live
 * dashboard tables (TRACKING.md 9). Registered with the tracking jobs
 * registry (6.4) so ingest, checkout and the admin pages restart it
 * in-process when Redis loses the BullMQ repeat key. The Live page stays
 * exact while it is behind: it adds the raw hits since the watermark.
 */
registerTrackingJob("rollup", { staleAfterMs: 180_000, run: runRollup })

export default async function trackingRollupJob(container: MedusaContainer) {
  await runTrackingJob(container, "rollup", runRollup)
}

export const config = {
  name: "tracking-rollup",
  schedule: "* * * * *",
}
