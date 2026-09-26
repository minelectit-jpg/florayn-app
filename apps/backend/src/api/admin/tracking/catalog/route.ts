import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CATALOG_MODULE } from "../../../../modules/catalog"
import {
  type FeedBuildState,
  type FeedFetch,
  feedMeta,
  type FeedMeta,
  type FeedPlatform,
  lastFeedFetches,
  publishAnyway,
  publishFeed,
} from "../../../../lib/tracking/catalog-feed"
import {
  convertPending,
  imageBatchLimit,
  type ImageProgress,
  imageProgress,
  isConverting,
  loadSharp,
} from "../../../../lib/tracking/catalog-images"
import { getState, trackingDb } from "../../../../lib/tracking/db"
import { type JobState, jobStates, kickStaleJobs } from "../../../../lib/tracking/jobs"
import {
  ensureFeedToken,
  loadTrackingSettings,
  rotateFeedToken,
  type TrackingConfig,
} from "../../../../lib/tracking/settings"
import { rebuildVariantIndex, type VariantIndexState } from "../../../../lib/tracking/variant-index"

/**
 * GET/POST /admin/tracking/catalog - Admin > Tracking > Catalog (TRACKING.md
 * 3.5, 4.6). GET: the catalog settings, the feed URLs to paste into Meta and
 * TikTok, the stored builds (without their bodies), the last fetch per
 * platform, image progress with the sharp status, the variant index and the
 * job state. POST { action }: "rebuild" and "convert_images" start in this
 * process and answer at once; "publish_anyway" publishes the held build;
 * "rotate_token" makes a new feed token (the old URLs stop working). The
 * catalog settings themselves are saved through /admin/tracking/settings.
 */

type Builds = Record<FeedPlatform, { candidate: FeedMeta | null; published: FeedMeta | null }>
type AdminRun = { action: string; started_at: string; finished_at: string | null; ok: boolean | null; message: string | null }

export type CatalogAdminView = {
  catalog: TrackingConfig["catalog"]
  case_types: { slug: string; name: string; is_active: boolean }[]
  feed_urls: { meta: string; meta_gz: string; tiktok: string; tiktok_gz: string }
  builds: Builds
  last_build: FeedBuildState | null
  last_fetch: Partial<Record<FeedPlatform, FeedFetch>>
  images: ImageProgress
  variant_index: VariantIndexState | null
  stale: { at: string } | null
  alert: { kind: string; at: string; detail?: string } | null
  job: JobState | null
  running: { rebuild: boolean; convert: boolean }
  last_admin_run: AdminRun | null
}

const ACTIONS = ["rebuild", "publish_anyway", "rotate_token", "convert_images"] as const
type Action = (typeof ACTIONS)[number]

let rebuilding = false
let lastRun: AdminRun | null = null

function errorText(error: unknown): string {
  const message = typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : String(error)
  return (message || "error").slice(0, 300)
}

/** Runs a slow action after the response, recording its outcome for the page. */
function background(action: string, work: () => Promise<string>): void {
  const run: AdminRun = { action, started_at: new Date(Date.now()).toISOString(), finished_at: null, ok: null, message: null }
  lastRun = run
  work()
    .then((message) => { run.ok = true; run.message = message })
    .catch((error) => { run.ok = false; run.message = errorText(error) })
    .finally(() => { run.finished_at = new Date(Date.now()).toISOString() })
}

function backendBase(req: MedusaRequest): string {
  const configured = (process.env.MEDUSA_BACKEND_URL ?? "").trim().replace(/\/+$/, "")
  if (configured) return configured
  const host = typeof req.get === "function" ? req.get("host") : req.headers.host
  return `${req.protocol || "https"}://${host ?? "localhost:9000"}`
}

async function caseTypeList(req: MedusaRequest): Promise<CatalogAdminView["case_types"]> {
  try {
    const catalog: any = req.scope.resolve(CATALOG_MODULE)
    const rows = await catalog.listCaseTypes({}, { order: { sort_order: "ASC" }, take: 200 })
    return (rows ?? []).map((c: any) => ({ slug: c.slug, name: c.name, is_active: c.is_active !== false }))
  } catch {
    return []
  }
}

async function view(req: MedusaRequest): Promise<CatalogAdminView> {
  const db = trackingDb(req.scope)
  const safe = <T>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback)
  const [{ config }, token, metas, fetches, images, index, stale, alert, build, jobs, caseTypes] = await Promise.all([
    loadTrackingSettings(req.scope),
    ensureFeedToken(req.scope),
    safe(feedMeta(req.scope), [] as FeedMeta[]),
    safe(lastFeedFetches(req.scope), {}),
    safe(imageProgress(req.scope), { ready: 0, failed: 0, sharp_installed: false, last_run: null } as ImageProgress),
    safe(getState<VariantIndexState>(db, "variant_index"), null),
    safe(getState<{ at: string }>(db, "catalog:stale"), null),
    safe(getState<CatalogAdminView["alert"]>(db, "catalog:alert"), null),
    safe(getState<FeedBuildState>(db, "catalog:build"), null),
    safe(jobStates(req.scope), null),
    caseTypeList(req),
  ])
  const base = `${backendBase(req)}/feeds/${token}`
  const builds = {} as Builds
  for (const platform of ["meta", "tiktok"] as const) {
    builds[platform] = {
      candidate: metas.find((m) => m.platform === platform && m.kind === "candidate") ?? null,
      published: metas.find((m) => m.platform === platform && m.kind === "published") ?? null,
    }
  }
  return {
    catalog: config.catalog,
    case_types: caseTypes,
    feed_urls: {
      meta: `${base}/meta.tsv`, meta_gz: `${base}/meta.tsv.gz`,
      tiktok: `${base}/tiktok.tsv`, tiktok_gz: `${base}/tiktok.tsv.gz`,
    },
    builds,
    last_build: build,
    last_fetch: fetches,
    images,
    variant_index: index,
    stale,
    alert,
    job: jobs?.catalog ?? null,
    running: { rebuild: rebuilding, convert: isConverting() },
    last_admin_run: lastRun,
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const body = await view(req)
  kickStaleJobs(req.scope)
  return res.json(body)
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.setHeader("Cache-Control", "private, no-store")
  const action = (req.body as { action?: unknown } | undefined)?.action
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return res.status(400).json({ message: `Unknown action. Use one of: ${ACTIONS.join(", ")}.` })
  }
  const { config } = await loadTrackingSettings(req.scope)
  let message: string

  switch (action as Action) {
    case "rebuild": {
      if (rebuilding) return res.status(409).json({ message: "A rebuild is already running." })
      rebuilding = true
      const enabled = config.catalog.enabled
      background("rebuild", async () => {
        try {
          const index = await rebuildVariantIndex(req.scope)
          if (!enabled) return `Variant index rebuilt: ${index.sellable} of ${index.count} variants sellable.`
          const result = await publishFeed(req.scope)
          return `Feed ${result.status}: ${result.items} items.`
        } finally {
          rebuilding = false
        }
      })
      message = enabled
        ? "Rebuilding the variant index and the feed. This takes a minute or two."
        : "The catalog feed is off, so only the variant index is rebuilt. Turn the feed on to build it."
      break
    }
    case "publish_anyway": {
      const result = await publishAnyway(req.scope)
      if (!result.ok) return res.status(409).json({ message: "There is no held build to publish." })
      message = `Published the held build (${result.items} items).`
      break
    }
    case "rotate_token": {
      await rotateFeedToken(req.scope)
      message = "New feed token made. Paste the new URLs into Meta and TikTok; the old ones stop working now."
      break
    }
    case "convert_images": {
      if (config.catalog.image_mode !== "jpeg_copies") {
        return res.status(409).json({ message: "Image mode is Cloudflare conversion, so no copies are needed." })
      }
      if (!(await loadSharp())) {
        return res.status(409).json({ message: "sharp is not installed on the server, so images cannot be converted." })
      }
      if (isConverting()) return res.status(409).json({ message: "Images are already being converted." })
      const enabled = config.catalog.enabled
      background("convert_images", async () => {
        const result = await convertPending(req.scope, { limit: imageBatchLimit(), concurrency: 2 })
        if (result.skipped === "running") return "Images were already being converted."
        let note = `Converted ${result.converted} images (${result.failed} failed, ${result.pending} still to do).`
        if (result.converted > 0 && enabled) {
          const feed = await publishFeed(req.scope)
          note += ` Feed ${feed.status}: ${feed.items} items.`
        }
        return note
      })
      message = "Converting the next batch of images. This takes a few minutes."
      break
    }
  }

  return res.json({ message, ...(await view(req)) })
}
