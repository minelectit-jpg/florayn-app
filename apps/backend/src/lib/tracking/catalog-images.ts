import crypto from "node:crypto"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

import { r2Bucket, r2Client } from "../r2"
import { getState, setState, trackingDb } from "./db"
import { loadTrackingSettings, type TrackingConfig } from "./settings"
import {
  forEachProductBatch,
  inFeedScope,
  loadCatalogRefs,
  PRODUCT_BASE_FIELDS,
  readVariantIndexState,
  resolveVariant,
} from "./variant-index"

/**
 * Catalog feed images (TRACKING.md 8.3). Meta needs JPEG or PNG, but the
 * renders are WebP on the rate-limited r2.dev host. In "jpeg_copies" mode each
 * image the feed needs becomes a 1200 px JPEG in R2 under feed-jpg/, served
 * from img.florayn.com, and is recorded in catalog_image. In "cf_transform"
 * mode Cloudflare converts on the fly and nothing is stored.
 *
 * sharp is loaded lazily through a non-literal specifier, so a server without
 * its binary keeps running and Admin > Tracking > Catalog says "sharp is not
 * installed" instead (0.2). catalog_image is a raw table written with the
 * PG_CONNECTION knex, a documented exception to AGENTS.md "no raw SQL"
 * (lib/tracking/db.ts); every statement uses bindings.
 */

type CatalogConfig = TrackingConfig["catalog"]

export type ImageState = {
  at: string
  sharp_missing: boolean
  /** Images the feed needs (first three of every in-scope variant). */
  needed: number
  ready: number
  /** Still to convert after this run. */
  pending: number
  converted: number
  failed: number
  last_error: string | null
}
export type ConvertResult = ImageState & { skipped?: "running" | "not_needed" }

type SharpInstance = {
  resize(width: number, height: number, options: { fit: "inside"; withoutEnlargement?: boolean }): SharpInstance
  jpeg(options: { quality: number; mozjpeg: boolean }): SharpInstance
  toBuffer(): Promise<Buffer>
}
type SharpFactory = (input: Buffer) => SharpInstance

export const FEED_JPG_PREFIX = "feed-jpg"
const IMAGES_PER_ITEM = 3
const DAY_LIMIT = 150
const NIGHT_LIMIT = 600
const DHAKA_OFFSET_MS = 6 * 3600_000
const RETRY_FAILED_AFTER_MS = 24 * 3600_000
const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
const MAX_ERROR = 300
const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable"
const CF_TRANSFORM = "cdn-cgi/image/format=jpeg,width=1200,quality=82"

/** Images per catalog-job run: 150 by day, 600 between 01:00 and 07:00 Dhaka. */
export function imageBatchLimit(now: Date = new Date(Date.now())): number {
  const hour = new Date(now.getTime() + DHAKA_OFFSET_MS).getUTCHours()
  return hour >= 1 && hour < 7 ? NIGHT_LIMIT : DAY_LIMIT
}

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex")
}

/** The R2 key of a source's JPEG copy. */
export function jpgKey(sourceUrl: string): string {
  return `${FEED_JPG_PREFIX}/${sha1(sourceUrl)}.jpg`
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The bucket key of an image in our R2 bucket (the URL's path, still
 * URL-encoded, without the leading slash), or null for any other host. Our
 * hosts are the r2.dev public URLs, the image base (img.florayn.com) and
 * R2_PUBLIC_URL; all serve the same keys (owner decision 5).
 */
export function sourceKey(sourceUrl: string, imageBaseUrl: string): string | null {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.hostname.toLowerCase()
  const ours = host.endsWith(".r2.dev") || host === hostOf(imageBaseUrl) || host === hostOf(process.env.R2_PUBLIC_URL)
  const key = url.pathname.replace(/^\/+/, "")
  return ours && key ? key : null
}

/**
 * Up to three images of a variant, in gallery order: its own
 * metadata.images, else the product thumbnail. http(s) URLs only, so the
 * inline SVG placeholders of a design without renders never reach a feed.
 */
export function variantImages(product: any, variant: any): string[] {
  const own = Array.isArray(variant?.metadata?.images) ? variant.metadata.images : []
  const list = own.length ? own : [product?.thumbnail]
  const urls: string[] = []
  for (const value of list) {
    if (typeof value !== "string") continue
    const url = value.trim()
    if (!/^https?:\/\//i.test(url) || urls.includes(url)) continue
    urls.push(url)
    if (urls.length === IMAGES_PER_ITEM) break
  }
  return urls
}

/**
 * The feed's link for one source image, or null while it is not ready.
 * jpeg_copies: the JPEG copy on the image base once catalog_image has it.
 * cf_transform: Cloudflare's converter in front of the same key.
 */
export function imageLinkFor(sourceUrl: string, catalog: CatalogConfig, ready: ReadonlySet<string>): string | null {
  if (catalog.image_mode === "cf_transform") {
    const key = sourceKey(sourceUrl, catalog.image_base_url)
    return key ? `${catalog.image_base_url}/${CF_TRANSFORM}/${key}` : null
  }
  return ready.has(sourceUrl) ? `${catalog.image_base_url}/${jpgKey(sourceUrl)}` : null
}

/** Source URLs whose JPEG copy is ready. */
export async function readyImageSources(container: any): Promise<Set<string>> {
  const result: any = await trackingDb(container).raw("select source_url from catalog_image where jpg_url is not null")
  return new Set<string>((result?.rows ?? []).map((row: any) => row.source_url))
}

let sharpLoad: Promise<SharpFactory | null> | null = null

/** sharp, or null when it is not installed or its binary does not load. Cached per process. */
export function loadSharp(): Promise<SharpFactory | null> {
  sharpLoad ??= (async () => {
    try {
      // A non-literal specifier: the bundler and the type checker never
      // require the package, so a missing binary cannot break the server.
      const name = "sharp"
      const loaded: any = await import(name)
      const factory = loaded?.default ?? loaded
      return typeof factory === "function" ? factory as SharpFactory : null
    } catch {
      return null
    }
  })()
  return sharpLoad
}

let neededCache: { key: string; sources: string[] } | null = null

/**
 * Every image the feed needs, first images first (they decide whether an
 * item can be listed at all), then the 2nd and 3rd. Cached per process until
 * the variant index is rebuilt or the case type lists change.
 */
export async function neededImageSources(container: any, catalog: CatalogConfig): Promise<string[]> {
  const index = await readVariantIndexState(container)
  const key = JSON.stringify([index?.built_at ?? null, catalog.include_case_types, catalog.exclude_case_types])
  if (index && neededCache?.key === key) return neededCache.sources
  const refs = await loadCatalogRefs(container)
  const primary = new Set<string>()
  const extra = new Set<string>()
  const noStock = { blank: {}, variant: {} }
  await forEachProductBatch(container, [...PRODUCT_BASE_FIELDS, "thumbnail", "variants.metadata"], { status: "published" }, (products) => {
    for (const product of products) {
      for (const variant of product?.variants ?? []) {
        if (!variant?.id) continue
        if (!inFeedScope(resolveVariant(product, variant, refs, noStock), catalog)) continue
        const [first, ...rest] = variantImages(product, variant)
        if (first) primary.add(first)
        for (const url of rest) extra.add(url)
      }
    }
  })
  const sources = [...primary, ...[...extra].filter((url) => !primary.has(url))]
  neededCache = { key, sources }
  return sources
}

function errorText(error: unknown): string {
  const message = typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : String(error)
  return (message || "error").slice(0, MAX_ERROR)
}

/** An object from our bucket, or null when it is not there (or R2 is unreachable). */
async function fromBucket(key: string): Promise<Buffer | null> {
  try {
    const out: any = await r2Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: decodeURIComponent(key) }))
    const bytes: Uint8Array | undefined = await out?.Body?.transformToByteArray?.()
    return bytes?.length ? Buffer.from(bytes) : null
  } catch {
    return null
  }
}

/**
 * The source bytes: straight from the bucket for our own keys (no r2.dev rate
 * limit), else, or when the key is not in the bucket, over HTTP. A problem
 * comes back as its message.
 */
async function download(sourceUrl: string, catalog: CatalogConfig): Promise<{ body: Buffer } | { error: string }> {
  const key = sourceKey(sourceUrl, catalog.image_base_url)
  let body = key ? await fromBucket(key) : null
  if (!body) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return { error: `The source image answered HTTP ${response.status}.` }
    body = Buffer.from(await response.arrayBuffer())
  }
  if (!body.length) return { error: "The source image is empty." }
  if (body.length > MAX_SOURCE_BYTES) return { error: "The source image is larger than 25 MB." }
  return { body }
}

async function recordImage(container: any, sourceUrl: string, jpgUrl: string | null, bytes: number | null,
  error: string | null): Promise<void> {
  await trackingDb(container).raw(
    `insert into catalog_image (source_url, jpg_url, bytes, error, created_at) values (?, ?, ?, ?, now())
on conflict (source_url) do update set jpg_url = excluded.jpg_url, bytes = excluded.bytes, error = excluded.error, created_at = now()`,
    [sourceUrl, jpgUrl, bytes, error]
  )
}

async function writeImageState(container: any, state: ImageState): Promise<void> {
  try {
    await setState(trackingDb(container), "catalog:images", state)
  } catch {
    // The admin page shows the previous run until the next write succeeds.
  }
}

let converting = false

/** Whether this process is converting images right now. */
export function isConverting(): boolean {
  return converting
}

/**
 * Converts up to `limit` pending feed images to JPEG copies, `concurrency`
 * at a time (2 by default): resize to fit 1200 x 1200, JPEG quality 82 with
 * mozjpeg, upload to feed-jpg/<sha1(source_url)>.jpg (immutable), record in
 * catalog_image. A failed image is recorded with its error and retried after
 * 24 h. Without sharp it records `sharp_missing` in tracking_state
 * `catalog:images` and returns without throwing. One run per process at a time.
 */
export async function convertPending(container: any, options: { limit: number; concurrency?: number }): Promise<ConvertResult> {
  const at = new Date(Date.now()).toISOString()
  const empty: ImageState = { at, sharp_missing: false, needed: 0, ready: 0, pending: 0, converted: 0, failed: 0, last_error: null }
  if (converting) return { ...empty, skipped: "running" }
  converting = true
  try {
    const { config } = await loadTrackingSettings(container)
    const catalog = config.catalog
    if (catalog.image_mode !== "jpeg_copies") return { ...empty, skipped: "not_needed" }

    const sharp = await loadSharp()
    if (!sharp) {
      const previous = await getState<ImageState>(trackingDb(container), "catalog:images").catch(() => null)
      const state: ImageState = { ...empty, ...(previous ?? {}), at, sharp_missing: true, converted: 0, failed: 0,
        last_error: "sharp is not installed" }
      await writeImageState(container, state)
      return state
    }

    const needed = await neededImageSources(container, catalog)
    const result: any = await trackingDb(container).raw(
      "select source_url, jpg_url is not null as ready, created_at from catalog_image"
    )
    const rows = new Map<string, { ready: boolean; at: number }>()
    for (const row of result?.rows ?? []) {
      rows.set(row.source_url, { ready: row.ready === true, at: new Date(row.created_at).getTime() })
    }
    const now = Date.now()
    const ready = needed.filter((url) => rows.get(url)?.ready).length
    const pending = needed.filter((url) => {
      const row = rows.get(url)
      if (!row) return true
      return !row.ready && !(now - row.at < RETRY_FAILED_AFTER_MS)
    })
    const batch = pending.slice(0, Math.max(0, Math.floor(options.limit)))
    const state: ImageState = { ...empty, needed: needed.length, ready, pending: pending.length }

    if (batch.length) {
      try {
        r2Client()
        r2Bucket()
      } catch (error) {
        const failedState = { ...state, last_error: errorText(error) }
        await writeImageState(container, failedState)
        return failedState
      }
    }

    let next = 0
    const worker = async () => {
      while (next < batch.length) {
        const sourceUrl = batch[next++]
        let problem: string | null = null
        try {
          const source = await download(sourceUrl, catalog)
          if ("error" in source) {
            problem = source.error
          } else {
            const jpg = await sharp(source.body).resize(1200, 1200, { fit: "inside" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
            const key = jpgKey(sourceUrl)
            await r2Client().send(new PutObjectCommand({
              Bucket: r2Bucket(),
              Key: key,
              Body: jpg,
              ContentType: "image/jpeg",
              CacheControl: IMAGE_CACHE_CONTROL,
            }))
            await recordImage(container, sourceUrl, `${catalog.image_base_url}/${key}`, jpg.length, null)
            state.converted += 1
          }
        } catch (error) {
          problem = errorText(error)
        }
        if (problem !== null) {
          state.failed += 1
          state.last_error = problem.slice(0, MAX_ERROR)
          await recordImage(container, sourceUrl, null, null, state.last_error).catch(() => undefined)
        }
      }
    }
    const workers = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)))
    await Promise.all(Array.from({ length: workers }, worker))

    state.ready += state.converted
    state.pending = Math.max(0, state.pending - state.converted - state.failed)
    await writeImageState(container, state)
    return state
  } finally {
    converting = false
  }
}

export type ImageProgress = {
  ready: number
  failed: number
  sharp_installed: boolean
  last_run: ImageState | null
}

/** Admin > Tracking > Catalog: copies made, failures, the last run and whether sharp loads. */
export async function imageProgress(container: any): Promise<ImageProgress> {
  const db = trackingDb(container)
  const [counts, lastRun, sharp] = await Promise.all([
    db.raw("select count(*) filter (where jpg_url is not null)::int as ready, count(*) filter (where jpg_url is null)::int as failed from catalog_image"),
    getState<ImageState>(db, "catalog:images"),
    loadSharp(),
  ])
  const row = (counts as any)?.rows?.[0] ?? {}
  return { ready: Number(row.ready ?? 0), failed: Number(row.failed ?? 0), sharp_installed: sharp !== null, last_run: lastRun }
}
