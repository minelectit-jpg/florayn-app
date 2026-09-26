import { MEDUSA_BACKEND_URL } from "../../medusa"
import type { BrowserEvent } from "../contract"
import { assertServer } from "./guard"
import { derivedIngestKey } from "./keys"
import type { IngestContext } from "./request-context"

assertServer()

/**
 * Storefront -> backend event forwarding (TRACKING.md 4.3). /api/t/e/ answers
 * 204 first and hands its events here inside after(), so the browser never
 * waits on the backend. Events are coalesced for 250 ms or 100 events,
 * grouped by (host, ctx), and POSTed to /tracking/ingest in envelopes of at
 * most 200 events and 256 KB, with the derived ingest key, a 3 s timeout and
 * one retry. A global cap of 3,000 events per 10 s protects the backend from
 * a flood. Counters (sf.*) ride in `stats`; if they are non-zero and nothing
 * was sent for 60 s they go alone. Nothing here throws and nothing is sent
 * without TRACKING_INGEST_SECRET.
 */
export const FORWARD_LIMITS = {
  coalesceMs: 250,
  coalesceEvents: 100,
  maxEvents: 200,
  maxBytes: 256 * 1024,
  timeoutMs: 3000,
  capEvents: 3000,
  capWindowMs: 10_000,
  statsIdleMs: 60_000,
  maxStatKeys: 50,
} as const

export type IngestBatch = { host: string; ctx: IngestContext; events: BrowserEvent[] }
export type IngestEnvelope = { v: 1; stats: Record<string, number>; batches: IngestBatch[] }

type Timer = unknown
type Post = { ok: boolean; status: number; body?: { cancel(): Promise<void> } | null }

export type ForwarderDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Post>
  now: () => number
  setTimer: (callback: () => void, ms: number) => Timer
  clearTimer: (timer: Timer) => void
  endpoint: () => string
  /** The derived ingest key, or null when the secret is unset. */
  key: () => string | null
}

export type Forwarder = {
  /** Queues events for the backend; resolves once they were sent or given up on. Never rejects. */
  forwardEvents(host: string, ctx: IngestContext, events: BrowserEvent[]): Promise<void>
  /** Adds to a counter that rides in the next envelope. */
  bumpStat(key: string, n?: number): void
  /** Sends everything queued now. */
  flush(): Promise<void>
}

/** The backend's stat key pattern (lib/tracking/contract.ts parseIngestEnvelope). */
const STAT_KEY = /^[a-z0-9_.:-]{1,60}$/
const RETRY_STATUSES = [408, 429]

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8")

type Chunk = { batches: IngestBatch[]; count: number }

/** Envelopes of at most 200 events and 256 KB; a (host, ctx) group may span several. */
function split(groups: IngestBatch[], stats: Record<string, number>): Chunk[] {
  const base = bytes({ v: 1, stats, batches: [] })
  const requests: Chunk[] = []
  let current = { batches: [] as IngestBatch[], count: 0, size: base }
  for (const group of groups) {
    const head = bytes({ host: group.host, ctx: group.ctx, events: [] }) + 1
    let batch: IngestBatch | null = null
    for (const event of group.events) {
      const size = bytes(event) + 1
      const full = current.count >= FORWARD_LIMITS.maxEvents
        || current.size + size + (batch ? 0 : head) > FORWARD_LIMITS.maxBytes
      if (full && current.count) {
        requests.push(current)
        current = { batches: [], count: 0, size: base }
        batch = null
      }
      if (!batch) {
        batch = { host: group.host, ctx: group.ctx, events: [] }
        current.batches.push(batch)
        current.size += head
      }
      batch.events.push(event)
      current.count += 1
      current.size += size
    }
  }
  if (current.count) requests.push(current)
  return requests
}

async function post(deps: ForwarderDeps, key: string, body: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await deps.fetch(deps.endpoint(), {
        method: "POST",
        headers: { "content-type": "application/json", "x-florayn-ingest-key": key },
        body,
        signal: AbortSignal.timeout(FORWARD_LIMITS.timeoutMs),
      })
      // Release the pooled connection; the body ({ accepted }) is not needed.
      res.body?.cancel().catch(() => {})
      if (res.ok) return true
      if (res.status < 500 && !RETRY_STATUSES.includes(res.status)) return false
    } catch {
      // Network error or timeout: retried once.
    }
  }
  return false
}

export function createForwarder(deps: ForwarderDeps): Forwarder {
  const groups = new Map<string, IngestBatch>()
  let queued = 0
  let waiting: (() => void)[] = []
  let flushTimer: Timer | null = null
  let statsTimer: Timer | null = null
  let stats: Record<string, number> = {}
  let lastSentAt = deps.now()
  let windowStart = Number.NEGATIVE_INFINITY
  let windowCount = 0

  function addStats(deltas: Record<string, number>): void {
    for (const [key, n] of Object.entries(deltas)) {
      if (!STAT_KEY.test(key) || !Number.isSafeInteger(n) || n <= 0) continue
      if (!(key in stats) && Object.keys(stats).length >= FORWARD_LIMITS.maxStatKeys) continue
      stats[key] = (stats[key] ?? 0) + n
    }
  }

  function scheduleStats(delay: number = FORWARD_LIMITS.statsIdleMs): void {
    // Without the secret nothing can be sent, so there is nothing to wake up for.
    if (statsTimer !== null || !deps.key()) return
    statsTimer = deps.setTimer(() => {
      statsTimer = null
      void statsTick()
    }, delay)
  }

  async function statsTick(): Promise<void> {
    if (!Object.keys(stats).length) return
    const idle = deps.now() - lastSentAt
    if (idle >= FORWARD_LIMITS.statsIdleMs && queued === 0) {
      await flush()
      if (Object.keys(stats).length) scheduleStats()
    } else {
      scheduleStats(Math.max(1000, FORWARD_LIMITS.statsIdleMs - idle))
    }
  }

  function bumpStat(key: string, n = 1): void {
    try {
      addStats({ [key]: n })
      if (Object.keys(stats).length) scheduleStats()
    } catch {
      // Counters are best effort.
    }
  }

  async function flush(): Promise<void> {
    if (flushTimer !== null) {
      deps.clearTimer(flushTimer)
      flushTimer = null
    }
    const pending = [...groups.values()]
    const settled = waiting
    groups.clear()
    queued = 0
    waiting = []
    try {
      const key = deps.key()
      if (!key) return
      const sending = stats
      stats = {}
      const requests = split(pending, sending)
      if (!requests.length && Object.keys(sending).length) requests.push({ batches: [], count: 0 })
      for (let index = 0; index < requests.length; index += 1) {
        const envelope: IngestEnvelope = { v: 1, stats: index === 0 ? sending : {}, batches: requests[index].batches }
        const ok = await post(deps, key, JSON.stringify(envelope))
        lastSentAt = deps.now()
        if (!ok) {
          if (index === 0) addStats(sending)
          if (requests[index].count) addStats({ "sf.forward_failed": requests[index].count })
        }
      }
    } catch {
      // Never throws: tracking must not break a request.
    } finally {
      for (const resolve of settled) resolve()
      if (Object.keys(stats).length) scheduleStats()
    }
  }

  function forwardEvents(host: string, ctx: IngestContext, events: BrowserEvent[]): Promise<void> {
    try {
      if (!events.length) return Promise.resolve()
      const now = deps.now()
      if (now - windowStart >= FORWARD_LIMITS.capWindowMs) {
        windowStart = now
        windowCount = 0
      }
      const kept = events.slice(0, Math.max(0, FORWARD_LIMITS.capEvents - windowCount))
      if (kept.length < events.length) bumpStat("sf.cap_dropped", events.length - kept.length)
      if (!kept.length) return Promise.resolve()
      windowCount += kept.length

      const id = `${host}\n${JSON.stringify(ctx)}`
      const group = groups.get(id)
      if (group) group.events.push(...kept)
      else groups.set(id, { host, ctx, events: [...kept] })
      queued += kept.length

      const settled = new Promise<void>((resolve) => waiting.push(resolve))
      if (queued >= FORWARD_LIMITS.coalesceEvents) {
        void flush()
      } else if (flushTimer === null) {
        flushTimer = deps.setTimer(() => {
          flushTimer = null
          void flush()
        }, FORWARD_LIMITS.coalesceMs)
      }
      return settled
    } catch {
      return Promise.resolve()
    }
  }

  return { forwardEvents, bumpStat, flush }
}

const forwarder = createForwarder({
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  setTimer: (callback, ms) => {
    const timer = setTimeout(callback, ms)
    // A pending flush or stats check must not keep a stopping process alive.
    ;(timer as { unref?: () => void }).unref?.()
    return timer
  },
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  endpoint: () => `${MEDUSA_BACKEND_URL}/tracking/ingest`,
  key: derivedIngestKey,
})

export const forwardEvents = forwarder.forwardEvents
export const bumpStat = forwarder.bumpStat
