import crypto from "node:crypto"
import { promisify } from "node:util"
import zlib from "node:zlib"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  type FeedPlatform,
  logFeedFetch,
  publishedBody,
  publishedEtag,
} from "../../../../lib/tracking/catalog-feed"
import { loadTrackingSettings } from "../../../../lib/tracking/settings"

/**
 * GET /feeds/:token/:file - the published catalog feed for Meta Commerce
 * Manager and TikTok Catalog Manager (TRACKING.md 8.4). Public route (not
 * under /store or /admin); the secret is the feed token in the path, compared
 * timing-safe with tracking_settings.catalog_feed_token. A bad token or file
 * is a plain 404 and is not logged (I24); valid fetches are logged to
 * catalog_feed_fetch for the "feed not fetched" alert.
 *
 * Serves the stored published bytes only, never builds on request: gzip as
 * stored (an in-memory copy per etag), `.gz` files raw, `.tsv` gzip-encoded
 * when the client accepts it, else inflated. ETag / If-None-Match gives 304.
 */

const FILES: Record<string, { platform: FeedPlatform; gz: boolean }> = {
  "meta.tsv": { platform: "meta", gz: false },
  "meta.tsv.gz": { platform: "meta", gz: true },
  "tiktok.tsv": { platform: "tiktok", gz: false },
  "tiktok.tsv.gz": { platform: "tiktok", gz: true },
}
const TSV = "text/tab-separated-values; charset=utf-8"
const gunzip = promisify(zlib.gunzip)

type Copy = { etag: string; gzip: Buffer; plain: Promise<Buffer> | null }
const copies = new Map<FeedPlatform, Copy>()

function digest(value: string): Buffer {
  return crypto.createHash("sha256").update(value).digest()
}

/** Timing-safe: both sides are hashed to the same length first. */
function sameToken(given: unknown, expected: string | null): boolean {
  if (!expected || typeof given !== "string" || !given || given.length > 200) return false
  return crypto.timingSafeEqual(digest(given), digest(expected))
}

function acceptsGzip(header: unknown): boolean {
  if (typeof header !== "string") return false
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";").map((value) => value.trim())
    if (name !== "gzip" && name !== "*") return false
    const q = params.find((param) => param.startsWith("q="))
    return !q || Number(q.slice(2)) > 0
  })
}

function matchesEtag(header: unknown, etag: string): boolean {
  if (typeof header !== "string") return false
  return header.split(",").map((value) => value.trim().replace(/^W\//, "")).some((value) => value === etag || value === "*")
}

function notFound(res: MedusaResponse) {
  res.status(404).json({ message: "Not found" })
}

async function currentCopy(req: MedusaRequest, platform: FeedPlatform, etag: string): Promise<Copy | null> {
  const cached = copies.get(platform)
  if (cached && cached.etag === etag) return cached
  const stored = await publishedBody(req.scope, platform)
  if (!stored) return null
  const copy: Copy = { etag: stored.etag, gzip: stored.gzip, plain: null }
  copies.set(platform, copy)
  return copy
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const file = typeof req.params.file === "string" ? req.params.file : ""
  const spec = Object.prototype.hasOwnProperty.call(FILES, file) ? FILES[file] : undefined
  if (!spec) return notFound(res)
  const { feedToken } = await loadTrackingSettings(req.scope)
  if (!sameToken(req.params.token, feedToken)) return notFound(res)

  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null
  const log = (status: number, bytes: number) => {
    logFeedFetch(req.scope, spec.platform, userAgent, status, bytes).catch(() => undefined)
  }
  res.setHeader("Cache-Control", "private, no-cache")

  const etag = await publishedEtag(req.scope, spec.platform)
  const copy = etag ? await currentCopy(req, spec.platform, etag) : null
  if (!copy) {
    log(404, 0)
    return notFound(res)
  }
  res.setHeader("ETag", copy.etag)
  if (!spec.gz) res.setHeader("Vary", "Accept-Encoding")
  if (matchesEtag(req.headers["if-none-match"], copy.etag)) {
    res.status(304).end()
    log(304, 0)
    return
  }

  let body: Buffer
  if (spec.gz) {
    res.setHeader("Content-Type", "application/gzip")
    body = copy.gzip
  } else if (acceptsGzip(req.headers["accept-encoding"])) {
    res.setHeader("Content-Type", TSV)
    res.setHeader("Content-Encoding", "gzip")
    body = copy.gzip
  } else {
    res.setHeader("Content-Type", TSV)
    copy.plain ??= gunzip(copy.gzip)
    copy.plain.catch(() => { copy.plain = null })
    body = await copy.plain
  }
  res.setHeader("Content-Length", String(body.length))
  res.status(200).end(body)
  log(200, body.length)
}
