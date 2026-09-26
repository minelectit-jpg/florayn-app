import type { MedusaContainer } from "@medusajs/framework/types"

import { checkAlerts } from "../lib/tracking/alerts"
import { getState, trackingDb } from "../lib/tracking/db"
import { registerTrackingJob, runTrackingJob } from "../lib/tracking/jobs"
import { pruneRetention, runOutboxSweep } from "../lib/tracking/outbox"

/**
 * Every minute: send the tracking outbox (TRACKING.md 6.3), check the alerts
 * (section 10) and, once an hour, delete what is past retention. Registered
 * with the tracking jobs registry (6.4) so ingest, checkout and the admin
 * pages restart it in-process when Redis loses the BullMQ repeat key.
 */
const PRUNE_EVERY_MS = 3_600_000

async function run(container: any): Promise<void> {
  // Each step runs even when an earlier one failed; the first error is what the job records.
  const errors: unknown[] = []
  try {
    await runOutboxSweep(container)
  } catch (error) {
    errors.push(error)
  }
  try {
    await checkAlerts(container)
  } catch (error) {
    errors.push(error)
  }
  try {
    const last = await getState<{ at?: string }>(trackingDb(container), "prune:last")
    const at = Date.parse(last?.at ?? "")
    if (!Number.isFinite(at) || Date.now() - at > PRUNE_EVERY_MS) await pruneRetention(container)
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw errors[0]
}

registerTrackingJob("outbox", { staleAfterMs: 180_000, run })

export default async function trackingOutboxJob(container: MedusaContainer) {
  await runTrackingJob(container, "outbox", run)
}

export const config = {
  name: "tracking-outbox",
  schedule: "* * * * *",
}
