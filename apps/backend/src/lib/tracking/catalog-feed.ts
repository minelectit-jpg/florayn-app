import crypto from "node:crypto"
import { promisify } from "node:util"
import zlib from "node:zlib"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { readAudienceTag } from "../audience"
import { blankAvailability, type StockMap, variantAvailability } from "../stock-availability"
import { imageLinkFor, readyImageSources, variantImages } from "./catalog-images"
import { getState, setState, trackingDb, withTransaction } from "./db"
import { loadTrackingSettings, type TrackingConfig } from "./settings"
import {
  expectedCasePrice,
  forEachProductBatch,
  inFeedScope,
  isRegularProduct,
  loadCatalogRefs,
  PRODUCT_BASE_FIELDS,
  resolveVariant,
  type ResolvedVariant,
  type VariantIndexState,
} from "./variant-index"

/**
 * The Meta and TikTok catalog feed (TRACKING.md 8.2, 8.5). One item per
 * sellable variant: `id` is the variant id, the same id every ViewContent,
 * AddToCart and Purchase sends as its content id, so catalog ads match events
 * one to one. Links are always the root product URL (men's pages canonicalise
 * there), availability is the shop's own blank/variant stock, and a case price
 * that disagrees with the case-type price map is left out rather than
 * advertised.
 *
 * The job builds rows, and publishes only when the content hash changed and
 * the item count did not collapse (the shrink guard holds the build and writes
 * tracking_state `catalog:alert`; WP03's checkAlerts emails, never this file).
 * catalog_feed / catalog_feed_fetch are raw tables written with the
 * PG_CONNECTION knex, a documented exception to AGENTS.md "no raw SQL"
 * (lib/tracking/db.ts); every statement uses bindings.
 */

export type FeedPlatform = "meta" | "tiktok"
export const FEED_PLATFORMS: readonly FeedPlatform[] = ["meta", "tiktok"]

export const META_COLUMNS = [
  "id", "title", "description", "availability", "condition", "price", "link", "image_link",
  "additional_image_link", "brand", "item_group_id", "google_product_category", "product_type", "gender",
  "internal_label", "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4",
] as const
export type FeedColumn = (typeof META_COLUMNS)[number]
export type FeedRow = Record<FeedColumn, string>

/** TikTok's catalog template names for the same rows; `internal_label` is Meta-only. */
export const TIKTOK_COLUMNS: readonly (readonly [string, FeedColumn])[] = [
  ["sku_id", "id"], ["title", "title"], ["description", "description"], ["availability", "availability"],
  ["condition", "condition"], ["price", "price"], ["link", "link"], ["image_link", "image_link"],
  ["additional_image_link", "additional_image_link"], ["brand", "brand"], ["item_group_id", "item_group_id"],
  ["google_product_category", "google_product_category"], ["product_type", "product_type"], ["gender", "gender"],
  ["custom_label_0", "custom_label_0"], ["custom_label_1", "custom_label_1"], ["custom_label_2", "custom_label_2"],
  ["custom_label_3", "custom_label_3"], ["custom_label_4", "custom_label_4"],
]

export type FeedWarning = { kind: "no_image" | "price_mismatch" | "empty"; count: number; examples: string[] }
export type FeedBuild = {
  rows: FeedRow[]
  warnings: FeedWarning[]
  counts: { in_scope: number; items: number; no_image: number; price_mismatch: number }
}
export type PerformanceTier = "top-sellers-30d" | "trending-7d" | "new-30d"
export type PublishStatus = "published" | "held" | "unchanged"
export type PublishResult = { status: PublishStatus; items: number; content_hash: string; warnings: FeedWarning[] }
export type FeedBuildState = { at: string; status: PublishStatus | "published_anyway"; items: number; content_hash: string; config_fp: string }
export type FeedMeta = {
  platform: FeedPlatform
  kind: "published" | "candidate"
  etag: string
  content_hash: string
  item_count: number
  built_at: string
  published_at: string | null
  status: string
  warnings: FeedWarning[]
  bytes: number
}

type CatalogConfig = TrackingConfig["catalog"]

const gzip = promisify(zlib.gzip)
const BRAND = "Florayn"
const TITLE_MAX = 200
const DESCRIPTION_MAX = 5000
const EXAMPLES = 10
const MAX_ERROR = 300
const TOP_N = 20
const DAY_MS = 24 * 3600_000
const DHAKA_OFFSET_MS = 6 * 3600_000
const DAILY_REBUILD = { hour: 3, minute: 30 }

const NOUN: Record<string, string> = { watch: "Band", wallet: "Wallet" }
const PRODUCT_TYPE: Record<string, string> = {
  iphone: "Phone Case", samsung: "Phone Case", airpods: "AirPods Case", watch: "Watch Band", wallet: "Wallet",
}
const GOOGLE_CATEGORY: Record<string, string> = {
  iphone: "Electronics > Communications > Telephony > Mobile Phone Accessories > Mobile Phone Cases",
  samsung: "Electronics > Communications > Telephony > Mobile Phone Accessories > Mobile Phone Cases",
  airpods: "Electronics > Audio > Audio Accessories > Headphone & Headset Accessories",
  watch: "Apparel & Accessories > Jewelry > Watch Accessories > Watch Bands",
  wallet: "Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips",
}
const REGULAR_CATEGORY = "Electronics > Communications > Telephony > Mobile Phone Accessories"
const SERIES: Record<string, string> = { airpods: "AirPods", watch: "Apple Watch", wallet: "Wallet" }
const GENDER: Record<string, string> = { women: "female", men: "male", both: "unisex" }

const FEED_FIELDS = [
  ...PRODUCT_BASE_FIELDS, "title", "description", "thumbnail", "metadata", "collection.title",
  "variants.title", "variants.metadata",
]

function errorText(error: unknown): string {
  const message = typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : String(error)
  return (message || "error").slice(0, MAX_ERROR)
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trimEnd() : value
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" }

/** Plain text from the admin's description (which may hold HTML): tags out, entities decoded, one line. */
export function plainText(value: unknown): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => ENTITIES[name] ?? " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** "1400.00 BDT" (the variant price, major units). */
export function feedPrice(amount: number): string {
  return `${amount.toFixed(2)} BDT`
}

/**
 * `<Design> - <Device> <Case type> Case`, with Band for watch bands and
 * Wallet for wallets. A device whose own name already ends in that word
 * ("Apple Watch Band", "Card Wallet") reads `<Design> - <Case type> <Device>`.
 */
export function itemTitle(design: string, deviceName: string, caseTypeName: string, family: string): string {
  const noun = NOUN[family] ?? "Case"
  const label = deviceName.toLowerCase().endsWith(` ${noun.toLowerCase()}`)
    ? `${caseTypeName} ${deviceName}`
    : `${deviceName} ${caseTypeName} ${noun}`
  return clip(`${design} - ${label}`, TITLE_MAX)
}

/** custom_label_1: "iPhone 17", "Samsung S24"; AirPods, Apple Watch and Wallet as families. */
export function deviceSeries(deviceName: string, family: string): string {
  if (SERIES[family]) return SERIES[family]
  const match = deviceName.match(/^(.*?\d+)/)
  return match ? match[1] : deviceName
}

/**
 * The root product URL for a variant (I10): case variants open their device
 * page with the case type preselected, regular products their variant. Device
 * slugs are the catalog's device slug for the variant's device name, the same
 * map the storefront builds (lib/sitemap-urls.ts, lib/device-page.ts).
 */
export function itemLink(base: string, resolved: ResolvedVariant): string | null {
  if (!resolved.handle) return null
  if (resolved.kind === "regular") return `${base}/product/${resolved.handle}/?variant=${resolved.variantId}`
  if (!resolved.device?.slug || !resolved.caseType?.slug) return null
  return `${base}/product/${resolved.handle}-${resolved.device.slug}/?case=${resolved.caseType.slug}`
}

const byText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

function dhakaDay(time: number): string {
  return new Date(time + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * custom_label_4 from the dashboard's per-product day table, only once it has
 * data: `top-sellers-30d` = the 20 handles with the most Purchase events in
 * the last 30 Dhaka days (at least 2 each); `trending-7d` = the next 20 by
 * AddToCart in the last 7 days (at least 3); `new-30d` = first seen in the
 * last 30 days, counted only when the table holds more than 30 days of
 * history. Any read error gives no labels.
 */
export async function performanceTiers(container: any, now: Date = new Date(Date.now())): Promise<Map<string, PerformanceTier>> {
  const tiers = new Map<string, PerformanceTier>()
  let rows: { key: string; purchases: number; adds: number; first_day: string }[]
  const since30 = dhakaDay(now.getTime() - 29 * DAY_MS)
  const since7 = dhakaDay(now.getTime() - 6 * DAY_MS)
  try {
    const result: any = await trackingDb(container).raw(
      `select key,
  coalesce(sum(count) filter (where event_name = 'Purchase' and day >= ?::date), 0)::int as purchases,
  coalesce(sum(count) filter (where event_name = 'AddToCart' and day >= ?::date), 0)::int as adds,
  min(day)::text as first_day
from tracking_day_dim where dim = 'product' group by key`,
      [since30, since7]
    )
    rows = (result?.rows ?? []).map((row: any) => ({
      key: String(row.key), purchases: Number(row.purchases) || 0, adds: Number(row.adds) || 0,
      first_day: String(row.first_day ?? "").slice(0, 10),
    }))
  } catch {
    return tiers
  }
  if (!rows.length) return tiers
  const top = rows.filter((row) => row.purchases >= 2).sort((a, b) => b.purchases - a.purchases || byText(a.key, b.key)).slice(0, TOP_N)
  for (const row of top) tiers.set(row.key, "top-sellers-30d")
  const trending = rows.filter((row) => !tiers.has(row.key) && row.adds >= 3)
    .sort((a, b) => b.adds - a.adds || byText(a.key, b.key)).slice(0, TOP_N)
  for (const row of trending) tiers.set(row.key, "trending-7d")
  const firstEver = rows.reduce((min, row) => row.first_day && row.first_day < min ? row.first_day : min, "9999-12-31")
  if (firstEver < since30) {
    for (const row of rows) {
      if (!tiers.has(row.key) && row.first_day >= since30) tiers.set(row.key, "new-30d")
    }
  }
  return tiers
}

class Warnings {
  private byKind = new Map<FeedWarning["kind"], FeedWarning>()
  add(kind: FeedWarning["kind"], example: string) {
    const entry = this.byKind.get(kind) ?? { kind, count: 0, examples: [] }
    entry.count += 1
    if (entry.examples.length < EXAMPLES) entry.examples.push(clip(example, 200))
    this.byKind.set(kind, entry)
  }
  list(): FeedWarning[] {
    return [...this.byKind.values()]
  }
}

/**
 * Builds the feed rows from the published products: one per variant in the
 * feed's scope (sellable, case type included), with its per-blank or
 * per-variant availability, the price guard and a ready image. Items without
 * a ready first image, and price mismatches, are left out and counted.
 */
export async function buildFeedRows(container: any, config: TrackingConfig): Promise<FeedBuild> {
  const catalog = config.catalog
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [refs, blank, ready, tiers] = await Promise.all([
    loadCatalogRefs(container),
    blankAvailability(query),
    catalog.image_mode === "jpeg_copies" ? readyImageSources(container) : Promise.resolve(new Set<string>()),
    performanceTiers(container),
  ])
  const warnings = new Warnings()
  const rows: FeedRow[] = []
  const seen = new Set<string>()
  const counts = { in_scope: 0, items: 0, no_image: 0, price_mismatch: 0 }

  await forEachProductBatch(container, FEED_FIELDS, { status: "published" }, async (products) => {
    for (const product of products) {
      if (!product?.id || product.status !== "published") continue
      const variantStock: StockMap = isRegularProduct(product) && product.handle
        ? await variantAvailability(query, product.handle)
        : {}
      const design = String(product.metadata?.design_name || product.title || product.handle || "").trim()
      const copy = plainText(product.description)
      const collection = typeof product.collection?.title === "string" ? product.collection.title : ""
      for (const variant of product.variants ?? []) {
        if (!variant?.id || seen.has(variant.id)) continue
        seen.add(variant.id)
        const r = resolveVariant(product, variant, refs, { blank, variant: variantStock })
        if (!inFeedScope(r, catalog) || r.price === null) continue
        counts.in_scope += 1

        if (r.kind === "case") {
          const expected = r.caseType && r.device ? expectedCasePrice(r.caseType, r.device.slug) : null
          if (expected === null || expected !== r.price) {
            counts.price_mismatch += 1
            warnings.add("price_mismatch", `${r.variantId} (${product.handle}, ${r.deviceName} ${r.caseTypeName}): ${r.price} BDT, case type price ${expected ?? "none"}`)
            continue
          }
        }
        const link = itemLink(catalog.base_url, r)
        if (!link) continue
        const images = variantImages(product, variant).map((url) => imageLinkFor(url, catalog, ready))
        if (!images[0]) {
          counts.no_image += 1
          warnings.add("no_image", `${r.variantId} (${product.handle})`)
          continue
        }

        const audience = readAudienceTag(r.kind === "regular" && variant.metadata?.audience ? variant.metadata : product.metadata)
        const family = r.device?.family ?? ""
        const variantTitle = typeof variant.title === "string" && variant.title && !/^default/i.test(variant.title) ? variant.title : ""
        const title = r.kind === "case"
          ? itemTitle(design, r.deviceName ?? "", r.caseTypeName ?? "", family)
          : clip(variantTitle ? `${design} - ${variantTitle}` : design, TITLE_MAX)
        const description = clip([copy, r.caseType?.description ?? ""].filter(Boolean).join(" ") || title, DESCRIPTION_MAX)
        rows.push({
          id: r.variantId,
          title,
          description,
          availability: r.inStock ? "in stock" : "out of stock",
          condition: "new",
          price: feedPrice(r.price),
          link,
          image_link: images[0],
          additional_image_link: images.slice(1).filter((url): url is string => Boolean(url)).join(","),
          brand: BRAND,
          item_group_id: r.productId,
          google_product_category: r.kind === "case" ? GOOGLE_CATEGORY[family] ?? "" : REGULAR_CATEGORY,
          product_type: r.kind === "case" ? `${PRODUCT_TYPE[family] ?? "Case"} > ${r.caseTypeName}` : "Accessories",
          gender: GENDER[audience] ?? "unisex",
          internal_label: r.sku ? `sku:${r.sku}` : "",
          custom_label_0: r.caseType?.slug ?? "",
          custom_label_1: r.kind === "case" ? deviceSeries(r.deviceName ?? "", family) : "",
          custom_label_2: collection,
          custom_label_3: audience,
          custom_label_4: tiers.get(r.handle) ?? "",
        })
      }
    }
  })

  // Code-point order, so the content hash never depends on the server locale.
  rows.sort((a, b) => byText(a.item_group_id, b.item_group_id) || byText(a.id, b.id))
  counts.items = rows.length
  if (!rows.length) warnings.add("empty", "The feed has no items yet.")
  return { rows, warnings: warnings.list(), counts }
}

/** One TSV value: tabs, CR and LF become spaces. */
function tsvValue(value: unknown): string {
  return String(value ?? "").replace(/[\t\r\n]/g, " ")
}

/** The feed file: a header row, then one line per item; Meta's column names or TikTok's. */
export function serializeTsv(rows: readonly FeedRow[], platform: FeedPlatform): string {
  const columns: readonly (readonly [string, FeedColumn])[] = platform === "tiktok"
    ? TIKTOK_COLUMNS
    : META_COLUMNS.map((column) => [column, column] as const)
  const lines = [columns.map(([name]) => name).join("\t")]
  for (const row of rows) lines.push(columns.map(([, key]) => tsvValue(row[key])).join("\t"))
  return `${lines.join("\n")}\n`
}

/** sha256 of the rows (column order fixed), the "did anything change" check (I11). */
export function contentHash(rows: readonly FeedRow[]): string {
  const hash = crypto.createHash("sha256")
  for (const row of rows) hash.update(`${JSON.stringify(META_COLUMNS.map((column) => row[column] ?? ""))}\n`)
  return hash.digest("hex")
}

/** What the rows depend on in the catalog settings, so a settings change triggers a build. */
export function catalogFingerprint(catalog: CatalogConfig): string {
  const { base_url, image_base_url, image_mode, include_case_types, exclude_case_types } = catalog
  return crypto.createHash("sha1")
    .update(JSON.stringify([base_url, image_base_url, image_mode, include_case_types, exclude_case_types]))
    .digest("hex").slice(0, 16)
}

function etagFor(hash: string, platform: FeedPlatform): string {
  return `"${hash.slice(0, 32)}-${platform}"`
}

// ---------------------------------------------------------------- storage

const WRITE_FEED_SQL = `insert into catalog_feed (platform, kind, body_gzip, etag, content_hash, item_count, built_at, published_at, status, warnings)
values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
on conflict (platform, kind) do update set body_gzip = excluded.body_gzip, etag = excluded.etag,
  content_hash = excluded.content_hash, item_count = excluded.item_count, built_at = excluded.built_at,
  published_at = excluded.published_at, status = excluded.status, warnings = excluded.warnings`

const COPY_HELD_SQL = `insert into catalog_feed (platform, kind, body_gzip, etag, content_hash, item_count, built_at, published_at, status, warnings)
select platform, 'published', body_gzip, etag, content_hash, item_count, built_at, now(), 'published', warnings
from catalog_feed where kind = 'candidate' and status = 'held'
on conflict (platform, kind) do update set body_gzip = excluded.body_gzip, etag = excluded.etag,
  content_hash = excluded.content_hash, item_count = excluded.item_count, built_at = excluded.built_at,
  published_at = excluded.published_at, status = excluded.status, warnings = excluded.warnings`

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const time = new Date(value as string).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** Every stored build without its body (admin, health, Live). */
export async function feedMeta(container: any): Promise<FeedMeta[]> {
  const result: any = await trackingDb(container).raw(
    "select platform, kind, etag, content_hash, item_count, built_at, published_at, status, warnings, octet_length(body_gzip)::int as bytes from catalog_feed"
  )
  return (result?.rows ?? []).map((row: any) => ({
    platform: row.platform,
    kind: row.kind,
    etag: row.etag,
    content_hash: row.content_hash,
    item_count: Number(row.item_count) || 0,
    built_at: iso(row.built_at) ?? "",
    published_at: iso(row.published_at),
    status: row.status,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    bytes: Number(row.bytes) || 0,
  }))
}

async function writeBuilds(container: any, rows: readonly FeedRow[], hash: string, builtAt: string,
  status: PublishStatus, warnings: FeedWarning[], publish: boolean): Promise<void> {
  const bodies = await Promise.all(FEED_PLATFORMS.map(async (platform) => ({
    platform,
    body: await gzip(Buffer.from(serializeTsv(rows, platform), "utf8")),
  })))
  const warningsJson = JSON.stringify(warnings)
  await withTransaction(container, async (trx) => {
    for (const { platform, body } of bodies) {
      const etag = etagFor(hash, platform)
      await trx.raw(WRITE_FEED_SQL, [platform, "candidate", body, etag, hash, rows.length, builtAt,
        publish ? builtAt : null, status, warningsJson])
      if (publish) {
        await trx.raw(WRITE_FEED_SQL, [platform, "published", body, etag, hash, rows.length, builtAt, builtAt,
          "published", warningsJson])
      }
    }
  })
}

/** Marks the stored candidate of this hash (optionally only while `onlyStatus`); returns the rows updated. */
async function touchCandidates(container: any, hash: string, onlyStatus: string | null, status: PublishStatus,
  builtAt: string, warnings: FeedWarning[]): Promise<number> {
  const bindings: unknown[] = [status, builtAt, JSON.stringify(warnings), hash]
  if (onlyStatus) bindings.push(onlyStatus)
  const result: any = await trackingDb(container).raw(
    `update catalog_feed set status = ?, built_at = ?, warnings = ?::jsonb where kind = 'candidate' and content_hash = ?${onlyStatus ? " and status = ?" : ""}`,
    bindings as any[]
  )
  return Number(result?.rowCount ?? 0)
}

/**
 * Builds the feed and decides (8.5): the same content hash as the published
 * build marks the candidate `unchanged` and publishes nothing; an item count
 * that dropped more than `shrink_guard_pct` against the published build is
 * `held` and writes `catalog:alert` { kind: "feed_guard" } (once per held
 * build); otherwise both platforms are published. A build with no items and
 * nothing published yet is held without an alert. A failure writes
 * `catalog:alert` { kind: "feed_error" } and rethrows for the job state.
 * Never sends email.
 */
export async function publishFeed(container: any): Promise<PublishResult> {
  const builtAt = new Date(Date.now()).toISOString()
  try {
    const { config } = await loadTrackingSettings(container)
    const build = await buildFeedRows(container, config)
    const hash = contentHash(build.rows)
    const items = build.rows.length
    const metas = await feedMeta(container)
    const published = metas.find((m) => m.platform === "meta" && m.kind === "published") ?? null
    const candidate = metas.find((m) => m.platform === "meta" && m.kind === "candidate") ?? null
    const guard = config.catalog.shrink_guard_pct
    let status: PublishStatus

    if (published && published.content_hash === hash) {
      status = "unchanged"
      const touched = await touchCandidates(container, hash, null, status, builtAt, build.warnings)
      if (touched < FEED_PLATFORMS.length) await writeBuilds(container, build.rows, hash, builtAt, status, build.warnings, false)
    } else if (published
      ? published.item_count > 0 && (published.item_count - items) * 100 > published.item_count * guard
      : items === 0) {
      status = "held"
      const sameHeld = candidate?.status === "held" && candidate.content_hash === hash
        && await touchCandidates(container, hash, "held", status, builtAt, build.warnings) >= FEED_PLATFORMS.length
      if (!sameHeld) {
        await writeBuilds(container, build.rows, hash, builtAt, status, build.warnings, false)
        if (published) {
          await setState(trackingDb(container), "catalog:alert", {
            kind: "feed_guard",
            at: builtAt,
            detail: `The catalog feed dropped from ${published.item_count} to ${items} items (more than ${guard}%), so it was held. Check Admin > Tracking > Catalog and publish it there if it is right.`,
          })
        }
      }
    } else {
      status = "published"
      await writeBuilds(container, build.rows, hash, builtAt, status, build.warnings, true)
    }

    const state: FeedBuildState = { at: builtAt, status, items, content_hash: hash, config_fp: catalogFingerprint(config.catalog) }
    await setState(trackingDb(container), "catalog:build", state)
    return { status, items, content_hash: hash, warnings: build.warnings }
  } catch (error) {
    try {
      await setState(trackingDb(container), "catalog:alert", { kind: "feed_error", at: builtAt, detail: errorText(error) })
    } catch {
      // The job state still records the error.
    }
    throw error
  }
}

/** Publishes the held build as it is (the owner's "Publish anyway"). */
export async function publishAnyway(container: any): Promise<{ ok: boolean; items: number }> {
  return withTransaction(container, async (trx) => {
    const held: any = await trx.raw("select platform, item_count from catalog_feed where kind = 'candidate' and status = 'held'")
    const rows = held?.rows ?? []
    if (!rows.length) return { ok: false, items: 0 }
    await trx.raw(COPY_HELD_SQL)
    await trx.raw("update catalog_feed set status = 'published', published_at = now() where kind = 'candidate' and status = 'held'")
    const build = await getState<FeedBuildState>(trx, "catalog:build")
    if (build) await setState(trx, "catalog:build", { ...build, status: "published_anyway" })
    return { ok: true, items: Number(rows[0].item_count) || 0 }
  })
}

/**
 * Records that products, variants, options or stock changed, so the catalog
 * job rebuilds the variant index and the feed. Called after every processed
 * storefront event batch; never throws.
 */
export async function markCatalogStale(container: any): Promise<void> {
  try {
    await setState(trackingDb(container), "catalog:stale", { at: new Date(Date.now()).toISOString() })
  } catch {
    // The daily rebuild still catches up.
  }
}

// ---------------------------------------------------------------- serving

/** The published build's etag for a platform, or null. */
export async function publishedEtag(container: any, platform: FeedPlatform): Promise<string | null> {
  const result: any = await trackingDb(container).raw(
    "select etag from catalog_feed where platform = ? and kind = 'published'", [platform]
  )
  return result?.rows?.[0]?.etag ?? null
}

/** The published gzip body and its etag, or null. */
export async function publishedBody(container: any, platform: FeedPlatform): Promise<{ etag: string; gzip: Buffer } | null> {
  const result: any = await trackingDb(container).raw(
    "select etag, body_gzip from catalog_feed where platform = ? and kind = 'published'", [platform]
  )
  const row = result?.rows?.[0]
  return row?.body_gzip ? { etag: row.etag, gzip: Buffer.from(row.body_gzip) } : null
}

/** One valid-token fetch (I24: bad tokens are never logged). */
export async function logFeedFetch(container: any, platform: FeedPlatform, userAgent: string | null,
  status: number, bytes: number): Promise<void> {
  await trackingDb(container).raw(
    "insert into catalog_feed_fetch (platform, user_agent, status, bytes) values (?, ?, ?, ?)",
    [platform, userAgent ? userAgent.slice(0, 200) : null, status, bytes]
  )
}

export type FeedFetch = { platform: FeedPlatform; fetched_at: string | null; status: number; user_agent: string | null; bytes: number }

/** The last valid fetch per platform. */
export async function lastFeedFetches(container: any): Promise<Partial<Record<FeedPlatform, FeedFetch>>> {
  const result: any = await trackingDb(container).raw(
    "select distinct on (platform) platform, fetched_at, status, user_agent, bytes from catalog_feed_fetch order by platform, fetched_at desc"
  )
  const fetches: Partial<Record<FeedPlatform, FeedFetch>> = {}
  for (const row of result?.rows ?? []) {
    if (row.platform !== "meta" && row.platform !== "tiktok") continue
    fetches[row.platform as FeedPlatform] = {
      platform: row.platform, fetched_at: iso(row.fetched_at), status: Number(row.status) || 0,
      user_agent: row.user_agent ?? null, bytes: Number(row.bytes) || 0,
    }
  }
  return fetches
}

// ---------------------------------------------------------------- job timing

/** The most recent 03:30 Asia/Dhaka at or before `now` (the daily forced rebuild). */
export function lastDailyRebuild(now: Date): Date {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS)
  let mark = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(),
    DAILY_REBUILD.hour, DAILY_REBUILD.minute) - DHAKA_OFFSET_MS
  if (mark > now.getTime()) mark -= DAY_MS
  return new Date(mark)
}

const time = (value: string | null | undefined) => {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : null
}

/** 8.1: rebuild when the index is empty, older than a change, or 24 h old. */
export function variantIndexDue(state: VariantIndexState | null, staleAt: string | null, now: Date): boolean {
  const built = time(state?.built_at)
  if (!state || !state.count || built === null) return true
  const stale = time(staleAt)
  if (stale !== null && stale > built) return true
  return now.getTime() - built >= DAY_MS
}

/**
 * 8.5: build the feed when there is no build yet, the catalog settings or the
 * products changed since the last build, images were converted this run, or
 * the daily 03:30 Dhaka rebuild is due.
 */
export function feedDue(input: {
  now: Date
  build: FeedBuildState | null
  staleAt: string | null
  configFp: string
  imagesConverted: number
}): boolean {
  const last = time(input.build?.at)
  if (!input.build || last === null) return true
  if (input.build.config_fp !== input.configFp || input.imagesConverted > 0) return true
  const stale = time(input.staleAt)
  if (stale !== null && stale > last) return true
  return last < lastDailyRebuild(input.now).getTime()
}
