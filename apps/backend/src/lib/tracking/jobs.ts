import { getState, setState, trackingDb } from "./db"

/**
 * The tracking jobs registry (TRACKING.md 6.4, invariant 2). Scheduled jobs
 * run through BullMQ repeat keys in Redis, which is allkeys-lru and has been
 * OOM-killed, so a job can silently stop being scheduled. Each job records its
 * runs in tracking_state (`job:<name>`), and ingest, the checkout record step
 * and the tracking admin GETs call kickStaleJobs(), which runs any registered
 * job that has not run within its staleAfterMs, in this process.
 *
 * Each job file calls registerTrackingJob() at module top level and its
 * default export calls runTrackingJob().
 */

export type TrackingJobName = "outbox" | "rollup" | "reconcile" | "catalog"

export type JobState = {
  last_run_at: string | null
  last_ok_at: string | null
  last_error: string | null
  last_error_at: string | null
}

type JobSpec = { staleAfterMs: number; run: (container: any) => Promise<void> }

export const TRACKING_JOB_NAMES: readonly TrackingJobName[] = ["outbox", "rollup", "reconcile", "catalog"]

const STATE_CACHE_MS = 30_000
const KICK_EVERY_MS = 60_000
const MAX_ERROR = 300

const registry = new Map<TrackingJobName, JobSpec>()
const running = new Set<TrackingJobName>()
const lastKick = new Map<TrackingJobName, number>()
let stateCache: { at: number; states: Promise<Record<TrackingJobName, JobState | null>> } | null = null

function stateKey(name: TrackingJobName): string {
  return `job:${name}`
}

function nowIso(): string {
  return new Date(Date.now()).toISOString()
}

function emptyState(): JobState {
  return { last_run_at: null, last_ok_at: null, last_error: null, last_error_at: null }
}

function errorText(error: unknown): string {
  const message = typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : String(error)
  return (message || "error").slice(0, MAX_ERROR)
}

/** Keeps the kick cache in step with what this process just wrote. */
function remember(name: TrackingJobName, state: JobState): void {
  const entry = stateCache
  if (!entry) return
  const updated = entry.states.then((states) => ({ ...states, [name]: state }))
  updated.catch(() => undefined)
  entry.states = updated
}

export function registerTrackingJob(name: TrackingJobName, spec: JobSpec): void {
  registry.set(name, spec)
}

async function writeState(container: any, name: TrackingJobName, state: JobState): Promise<void> {
  try {
    await setState(trackingDb(container), stateKey(name), state)
  } catch {
    // A state write must never fail the job; the next run writes again.
  }
  remember(name, state)
}

/**
 * Runs one job: writes `last_run_at` first, then `last_ok_at` or
 * `last_error` (at most 300 chars). A second call while the job is still
 * running in this process is skipped. Never throws.
 */
export async function runTrackingJob(container: any, name: TrackingJobName, run: (container: any) => Promise<void>): Promise<void> {
  if (running.has(name)) return
  running.add(name)
  try {
    let previous: JobState | null = null
    try {
      previous = await getState<JobState>(trackingDb(container), stateKey(name))
    } catch {
      previous = null
    }
    const state: JobState = { ...emptyState(), ...(previous ?? {}), last_run_at: nowIso() }
    await writeState(container, name, state)
    try {
      await run(container)
      await writeState(container, name, { ...state, last_ok_at: nowIso() })
    } catch (error) {
      await writeState(container, name, { ...state, last_error: errorText(error), last_error_at: nowIso() })
    }
  } catch {
    // Nothing above should throw; this keeps the promise itself from rejecting.
  } finally {
    running.delete(name)
  }
}

async function readStates(container: any): Promise<Record<TrackingJobName, JobState | null>> {
  const db = trackingDb(container)
  const states = {} as Record<TrackingJobName, JobState | null>
  for (const name of TRACKING_JOB_NAMES) states[name] = await getState<JobState>(db, stateKey(name))
  return states
}

/** Every job's last run, success and error (for Health and Live). */
export async function jobStates(container: any): Promise<Record<TrackingJobName, JobState | null>> {
  return readStates(container)
}

function cachedStates(container: any, now: number): Promise<Record<TrackingJobName, JobState | null>> {
  if (stateCache && now - stateCache.at < STATE_CACHE_MS) return stateCache.states
  const entry = { at: now, states: readStates(container) }
  stateCache = entry
  entry.states.catch(() => { if (stateCache === entry) stateCache = null })
  return entry.states
}

async function kick(container: any): Promise<void> {
  if (!registry.size) return
  const now = Date.now()
  const states = await cachedStates(container, now)
  for (const [name, spec] of registry) {
    if (running.has(name)) continue
    const kicked = lastKick.get(name)
    if (kicked !== undefined && now - kicked < KICK_EVERY_MS) continue
    const lastRun = Date.parse(states[name]?.last_run_at ?? "")
    if (Number.isFinite(lastRun) && now - lastRun <= spec.staleAfterMs) continue
    lastKick.set(name, now)
    void runTrackingJob(container, name, spec.run)
  }
}

/**
 * Fire-and-forget: runs, in this process, every registered job whose last run
 * is older than its staleAfterMs (or that never ran), at most once a minute
 * per job. States are cached for 30 s. Never throws and never waits.
 */
export function kickStaleJobs(container: any): void {
  try {
    kick(container).catch(() => undefined)
  } catch {
    // Never let a kick affect the request that triggered it.
  }
}
