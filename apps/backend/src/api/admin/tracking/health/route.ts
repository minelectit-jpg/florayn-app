import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { emailConfigured } from "../../../../lib/send-email"
import { alertStates } from "../../../../lib/tracking/alerts"
import { getState, trackingDb } from "../../../../lib/tracking/db"
import { counters24h, outboxHealth } from "../../../../lib/tracking/health"
import { jobStates, kickStaleJobs } from "../../../../lib/tracking/jobs"
import { destinationFor, loadTrackingSettings } from "../../../../lib/tracking/settings"

/**
 * GET /admin/tracking/health - Tracking > Health (TRACKING.md 3.5, 4.6): the
 * outbox per platform/env (the same outboxHealth() the Live page uses), job
 * states, 24 h counters, the variant index, open alerts and whether email is
 * configured. Each part is read on its own, so one missing table does not
 * blank the page. Opening the page also restarts stale tracking jobs.
 */
async function part<T>(errors: string[], name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    errors.push(`${name} could not be read`)
    return null
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const scope = req.scope
  const db = trackingDb(scope)
  const fresh = (req.query as Record<string, unknown> | undefined)?.fresh === "1"
  const errors: string[] = []
  const [platforms, jobs, counters, variantIndex, alerts, alertsLast, prune, settings] = await Promise.all([
    part(errors, "outbox", () => outboxHealth(scope, fresh ? { maxAgeMs: 0 } : {})),
    part(errors, "jobs", () => jobStates(scope)),
    part(errors, "counters", () => counters24h(scope)),
    part(errors, "variant index", () => getState(db, "variant_index")),
    part(errors, "alerts", () => alertStates(scope)),
    part(errors, "last alert run", () => getState(db, "alerts:last")),
    part(errors, "retention", () => getState(db, "prune:last")),
    part(errors, "settings", () => loadTrackingSettings(scope)),
  ])
  kickStaleJobs(scope)

  const config = settings?.config
  const testHost = config?.test_hosts[0] ?? null
  const testReady = (platform: "meta" | "tiktok") =>
    Boolean(config && testHost && destinationFor(config, testHost, platform) && settings?.tokenSet[platform].test)

  return res.json({
    platforms: platforms ?? [],
    jobs: jobs ?? {},
    counters: counters ?? {},
    variant_index: variantIndex,
    email_configured: emailConfigured(),
    alerts: { enabled: config?.alerts.enabled ?? null, email: config?.alerts.email ?? null, states: alerts ?? [], last: alertsLast },
    prune,
    dry_run: process.env.TRACKING_DRY_RUN === "1",
    enabled: { meta: config?.meta.enabled ?? false, tiktok: config?.tiktok.enabled ?? false },
    test: {
      host: testHost,
      meta: testReady("meta"),
      tiktok: testReady("tiktok"),
      meta_test_event_code: Boolean(config?.meta.test_event_code),
    },
    errors,
  })
}
