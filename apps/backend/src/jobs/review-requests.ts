import type { MedusaContainer } from "@medusajs/framework/types"

import { loadReviewProgram } from "../lib/review-program"
import { runReviewRequests } from "../lib/review-requests"

/**
 * Hourly: mail "How is your Florayn order?" to orders that have been
 * delivered for the set number of days (Admin > Reviews > Request emails).
 * Does nothing while requests are switched off; the daily limit is shared
 * across runs, so hourly checks never exceed it.
 */
export default async function reviewRequestsJob(container: MedusaContainer) {
  const { settings } = await loadReviewProgram(container)
  if (!settings.requests.enabled) return
  await runReviewRequests(container, settings)
}

export const config = {
  name: "review-requests",
  schedule: "17 * * * *",
}
