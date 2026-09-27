import type { MedusaContainer } from "@medusajs/framework/types"

import { registerTrackingJob, runTrackingJob } from "../lib/tracking/jobs"
import { reconcilePurchases } from "../lib/tracking/purchase"

/**
 * Every 5 minutes (TRACKING.md 6.6): records Purchases the checkout missed
 * (a crash or a lost request after the order was placed), gives recent
 * orders their order_op row when order.placed was lost, and adds a missing
 * Purchase outbox row per platform. Registered with the tracking jobs
 * registry (6.4) so ingest, checkout and the admin pages restart it
 * in-process when Redis loses the BullMQ repeat key.
 */
registerTrackingJob("reconcile", { staleAfterMs: 900_000, run: reconcilePurchases })

export default async function trackingReconcileJob(container: MedusaContainer) {
  await runTrackingJob(container, "reconcile", reconcilePurchases)
}

export const config = {
  name: "tracking-reconcile",
  schedule: "*/5 * * * *",
}
