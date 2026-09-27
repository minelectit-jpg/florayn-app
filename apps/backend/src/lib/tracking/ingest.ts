import type { EventInput, EventItemInput } from "./adapters/common"
import { buildMetaEvent } from "./adapters/meta"
import { buildTikTokEvent } from "./adapters/tiktok"
import {
  isVariantId,
  pathnameOf,
  validateEvent,
  type BrowserEvent,
  type BrowserEventName,
  type EventItem,
  type IngestBatch,
  type IngestEnvelope,
} from "./contract"
import { bumpCounters, HIT_FLAGS, insertHits, withTransaction, type HitInsert, type OutboxInsert } from "./db"
import { sha256Hex } from "./hash"
import { kickStaleJobs } from "./jobs"
import { enqueue, scheduleFlush } from "./outbox"
import { destinationFor, hostRole, loadTrackingSettings, type TrackingSettingsView } from "./settings"
import { lookupVariants, type IndexedVariant } from "./variant-index"

/**
 * Browser events forwarded by the storefront (TRACKING.md 4.3, 6.1, B5, B6):
 * turns each batch into dashboard hits, Meta/TikTok outbox rows and counters,
 * and writes them in one transaction. The storefront has already checked the
 * edge header, the host, the rate limits and each event's shape; the ingest
 * key is the trust here, so nothing is re-derived from `ctx.edge`. Everything
 * the browser claims that could reach an ad platform is re-checked: events
 * are validated again, prices come from the variant index, values are
 * clamped, and an unknown variant id is counted but never sent.
 *
 * Nothing here calls a vendor. Rows are sent by the outbox (scheduleFlush
 * after commit, and the every-minute job), so the storefront's request only
 * waits for one short database transaction.
 *
 * The one raw statement (`SET LOCAL statement_timeout`) goes through the
 * PG_CONNECTION transaction like the rest of lib/tracking/db.ts, the
 * documented exception to AGENTS.md "no raw SQL".
 */

/** How far an event's time may sit from this clock (4.3). The storefront already clock-fixed it. */
export const EVENT_WINDOW_MS = { past: 15 * 60_000, future: 60_000 } as const

/** Shorter than the rollup's 20 s grace (I15), so a slow ingest never lands behind the watermark. */
const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '5s'"

const SERVER_COPIES: Record<"meta" | "tiktok", ReadonlySet<BrowserEventName>> = {
  meta: new Set(["PageView", "ViewContent", "AddToCart", "InitiateCheckout"]),
  // The Events API has no web PageView; TikTok's PageView is the browser's ttq.page() (C3).
  tiktok: new Set(["ViewContent", "AddToCart", "InitiateCheckout"]),
}
const PLATFORMS = ["meta", "tiktok"] as const

/** Counter keys the storefront may send in `stats`; others are ignored, so it cannot raise backend alerts. */
const STAT_PREFIX = "sf."

export type IngestRows = { hits: HitInsert[]; outbox: OutboxInsert[]; counters: Record<string, number> }

type Counts = Record<string, number>
type Priced = { items: EventItemInput[]; value: number; quantity: number; known: boolean }

function count(counters: Counts, key: string, n = 1): void {
  counters[key] = (counters[key] ?? 0) + n
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

/** What checkout charges for the variant, or null when the index does not know it or has no price for it. */
function indexPrice(entry: IndexedVariant | undefined): number | null {
  const price = entry?.price
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null
}

/**
 * B5: every item priced from the variant index and the value clamped to
 * [0, sum(index price * q)]. An item the index does not know adds nothing to
 * that bound and makes the event unknown (hit flag 64, no ad rows). Null for
 * PageView, which has no items.
 */
function priceEvent(event: BrowserEvent, variants: ReadonlyMap<string, IndexedVariant>): Priced | null {
  const raw = event.d?.items
  if (!Array.isArray(raw)) return null
  const items: EventItemInput[] = []
  let known = true
  let bound = 0
  let quantity = 0
  for (const item of raw as EventItem[]) {
    quantity += item.q
    const price = indexPrice(variants.get(item.id))
    if (price === null) {
      known = false
      continue
    }
    items.push({ id: item.id, quantity: item.q, price })
    bound += price * item.q
  }
  const claimed = event.d?.value
  const value = typeof claimed === "number" ? Math.min(Math.max(claimed, 0), bound) : 0
  return { items, value: round2(value), quantity, known }
}

function hitFlags(event: BrowserEvent, batch: IngestBatch, priced: Priced | null): number {
  const d = event.d ?? {}
  let flags = 0
  if (event.n === "ViewContent" && d.primary === true) flags |= HIT_FLAGS.PRIMARY
  if (event.n === "ViewContent" && d.primary === false) flags |= HIT_FLAGS.VARIANT_SWITCH
  if (batch.ctx.staff) flags |= HIT_FLAGS.INTERNAL
  if (batch.ctx.new) flags |= HIT_FLAGS.NEW_VISITOR
  if (event.n === "PageView" && d.first === true) flags |= HIT_FLAGS.FIRST_PAGEVIEW
  if (priced && !priced.known) flags |= HIT_FLAGS.UNKNOWN_VARIANT
  return flags
}

/**
 * The dashboard row. Product facts come from the index when it knows the
 * first item (the handle is what the rollup and the catalog labels key on),
 * else from what the browser sent. Never the IP or user agent.
 */
function buildHit(
  event: BrowserEvent,
  batch: IngestBatch,
  priced: Priced | null,
  variants: ReadonlyMap<string, IndexedVariant>
): HitInsert {
  const { ctx } = batch
  const d = event.d ?? {}
  const first = Array.isArray(d.items) ? (d.items as EventItem[])[0] : undefined
  const indexed = first ? variants.get(first.id) : undefined
  return {
    event_name: event.n,
    event_id: event.id,
    origin: "b",
    visitor_id: ctx.optout ? null : ctx.vid,
    session_id: ctx.optout ? null : ctx.sid,
    source: ctx.src,
    campaign: ctx.camp,
    device_class: ctx.device,
    audience: ctx.audience,
    host: batch.host,
    path: pathnameOf(event.p),
    handle: text(indexed?.handle) ?? text(d.handle),
    variant_id: first?.id ?? null,
    device: text(indexed?.device) ?? text(d.device),
    case_type: text(indexed?.case_type) ?? text(d.case_type),
    value: priced ? priced.value : null,
    items: priced ? priced.quantity : null,
    // parseCheckoutContext keeps only two capital letters.
    country: ctx.country,
    flags: hitFlags(event, batch, priced),
  }
}

/** The adapter input shared by the Meta and TikTok copies of one event. */
function eventInput(event: BrowserEvent, batch: IngestBatch, priced: Priced | null, externalId: string | null): EventInput {
  const { ctx } = batch
  const custom: EventInput["custom"] = {}
  if (priced) {
    custom.items = priced.items
    custom.value = priced.value
    if (event.n === "InitiateCheckout") {
      const numItems = event.d?.num_items
      custom.numItems = Number.isSafeInteger(numItems) ? numItems as number : priced.quantity
    }
  }
  return {
    name: event.n,
    eventId: event.id,
    time: new Date(event.t),
    // `p` is already the public path with only case/device/variant kept (validateEvent).
    url: `https://${batch.host}${event.p}`,
    actionSource: "website",
    user: {
      ip: ctx.ip,
      ua: ctx.ua,
      fbp: ctx.fbp,
      fbc: ctx.fbc,
      externalId,
      country: ctx.country,
      ttclid: ctx.ttclid,
      ttp: ctx.ttp,
    },
    custom,
  }
}

/**
 * The events of a batch that pass the backend contract and the time window,
 * each (name, id) once. The rest are counted as `ingest.invalid`.
 */
function acceptedEvents(batch: IngestBatch, now: number, counters: Counts): BrowserEvent[] {
  const seen = new Set<string>()
  const events: BrowserEvent[] = []
  for (const raw of batch.events) {
    const event = validateEvent(raw)
    if (!event || event.t < now - EVENT_WINDOW_MS.past || event.t > now + EVENT_WINDOW_MS.future) {
      count(counters, "ingest.invalid")
      continue
    }
    const key = `${event.n}\n${event.id}`
    if (seen.has(key)) continue
    seen.add(key)
    events.push(event)
  }
  return events
}

/**
 * Hits, outbox rows and counters for one batch (6.1, 2.4). Pure: the caller
 * passes the settings, the index facts for the batch's variant ids and the
 * clock. A batch for a host that is not allowlisted is dropped whole.
 *
 * Per event and platform a `pending` row is added only when the host has a
 * destination for the platform, its token for that environment is set (else
 * `ingest.no_token_dropped`), the visitor is not staff or opted out, every
 * item is a known priced variant, and for Meta a user agent exists (Meta
 * refuses website events without one). An enabled platform with no id for
 * this environment counts `ingest.no_destination`.
 */
export function buildRows(
  settings: TrackingSettingsView,
  variants: ReadonlyMap<string, IndexedVariant>,
  batch: IngestBatch,
  now: number
): IngestRows {
  const rows: IngestRows = { hits: [], outbox: [], counters: {} }
  const { config, tokenSet } = settings
  const { ctx, host } = batch
  if (!hostRole(config, host)) {
    count(rows.counters, "ingest.unknown_host", batch.events.length)
    return rows
  }
  const events = acceptedEvents(batch, now, rows.counters)
  const sendable = !ctx.staff && !ctx.optout
  const externalId = sha256Hex(ctx.vid)
  for (const event of events) {
    const priced = priceEvent(event, variants)
    rows.hits.push(buildHit(event, batch, priced, variants))
    if (priced && !priced.known) {
      count(rows.counters, "ingest.unknown_variant")
      continue
    }
    if (!sendable) continue
    let input: EventInput | null = null
    for (const platform of PLATFORMS) {
      if (!SERVER_COPIES[platform].has(event.n)) continue
      const destination = destinationFor(config, host, platform)
      if (!destination) {
        if (config[platform].enabled) count(rows.counters, "ingest.no_destination")
        continue
      }
      if (!tokenSet[platform][destination.env]) {
        count(rows.counters, "ingest.no_token_dropped")
        continue
      }
      if (platform === "meta" && !ctx.ua) continue
      input ??= eventInput(event, batch, priced, externalId)
      const payload = platform === "meta" ? buildMetaEvent(input) : buildTikTokEvent(input)
      if (!payload) continue
      rows.outbox.push({
        platform,
        env: destination.env,
        destination: destination.id,
        event_name: event.n,
        event_id: event.id,
        event_time: new Date(event.t),
        source: "browser",
        payload,
      })
    }
  }
  return rows
}

/** Every well-formed variant id the envelope mentions, for one index lookup. */
export function envelopeVariantIds(envelope: IngestEnvelope): string[] {
  const ids = new Set<string>()
  for (const batch of envelope.batches) {
    for (const event of batch.events) {
      const items = (event as { d?: { items?: unknown } } | null)?.d?.items
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const id = (item as { id?: unknown } | null)?.id
        if (isVariantId(id)) ids.add(id)
      }
    }
  }
  return [...ids]
}

/**
 * Records one envelope: hits, outbox rows and counters (buildRows plus the
 * storefront's `sf.*` stats, which arrive even when there are no batches) in
 * ONE transaction with a 5 s statement timeout. Resending the same envelope
 * adds no rows: hits and outbox rows are keyed by event id. After the commit
 * the outbox flush is scheduled (never awaited) and stale jobs are kicked.
 * Returns how many events were accepted.
 */
export async function ingest(container: any, envelope: IngestEnvelope): Promise<number> {
  const now = Date.now()
  const settings = await loadTrackingSettings(container)
  const ids = envelopeVariantIds(envelope)
  const variants = ids.length ? await lookupVariants(container, ids) : new Map<string, IndexedVariant>()

  const hits: HitInsert[] = []
  const outbox: OutboxInsert[] = []
  const counters: Counts = {}
  for (const batch of envelope.batches) {
    const rows = buildRows(settings, variants, batch, now)
    hits.push(...rows.hits)
    outbox.push(...rows.outbox)
    for (const [key, n] of Object.entries(rows.counters)) count(counters, key, n)
  }
  for (const [key, n] of Object.entries(envelope.stats)) {
    if (key.startsWith(STAT_PREFIX) && n > 0) count(counters, key, n)
  }

  let queued = 0
  if (hits.length || outbox.length || Object.keys(counters).length) {
    queued = await withTransaction(container, async (trx) => {
      await trx.raw(STATEMENT_TIMEOUT)
      await insertHits(trx, hits)
      const inserted = await enqueue(trx, outbox)
      await bumpCounters(trx, counters)
      return inserted
    })
  }
  if (queued > 0) scheduleFlush(container)
  kickStaleJobs(container)
  return hits.length
}
