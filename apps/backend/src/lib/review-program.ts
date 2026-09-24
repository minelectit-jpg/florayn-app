import { Modules } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"

import { WORKFLOW_STATUSES, type WorkflowStatus } from "./order-ops"

/**
 * The review programme: the "How is your Florayn order?" request emails and
 * the discount a customer earns for a review. Mirrors florayn.com's
 * florayn-core plugin (review-requests.php / review-rewards.php), with the same
 * defaults, and lives in the store's metadata so the admin edits it without a
 * deploy (Admin > Reviews).
 */
export const REVIEW_PROGRAM_KEY = "florayn_review_program"

export type ReviewProgram = {
  requests: {
    /** Off until the owner switches it on. */
    enabled: boolean
    /** Days an order sits in a qualifying status before it is asked. */
    delay_days: number
    /** Order Management statuses that count as "received". */
    statuses: WorkflowStatus[]
    /** Most emails per run, to protect the sending reputation. */
    batch: number
    /** Orders older than this are never asked. */
    max_age_days: number
    /** When requests were first switched on: older orders are not mailed. */
    started_at: string | null
  }
  rewards: {
    enabled: boolean
    /** % off for a review with photos. */
    photo_pct: number
    /** % off for a text-only review. */
    text_pct: number
    /** Days a code stays valid; 0 = never expires. */
    expiry_days: number
    /** One code per email address this often; 0 = no limit. */
    cooldown_days: number
    max_photos: number
    /** Lowest star rating that still earns a code. */
    min_rating: number
  }
  /** Publish reviews at once, or hold them for approval (the code follows publication). */
  auto_approve: boolean
  /** Sender name on every review email. */
  from_name: string
}

export const DEFAULT_REVIEW_PROGRAM: ReviewProgram = {
  requests: { enabled: false, delay_days: 4, statuses: ["delivered"], batch: 40, max_age_days: 120, started_at: null },
  rewards: { enabled: true, photo_pct: 15, text_pct: 10, expiry_days: 60, cooldown_days: 30, max_photos: 3, min_rating: 1 },
  auto_approve: false,
  from_name: "Florayn",
}

const LIMITS = {
  delay_days: [0, 60],
  batch: [1, 500],
  max_age_days: [1, 3650],
  photo_pct: [0, 90],
  text_pct: [0, 90],
  expiry_days: [0, 3650],
  cooldown_days: [0, 3650],
  max_photos: [1, 6],
  min_rating: [1, 5],
} as const

const whole = (value: unknown, [min, max]: readonly [number, number], fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/** A stored value made whole: unknown keys dropped, numbers bounded, defaults filled. */
export function readReviewProgram(value: unknown): ReviewProgram {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, any>
  const r = raw.requests ?? {}
  const w = raw.rewards ?? {}
  const d = DEFAULT_REVIEW_PROGRAM
  const statuses = Array.isArray(r.statuses) ? r.statuses.filter((s: unknown) => (WORKFLOW_STATUSES as readonly string[]).includes(String(s))) : []
  return {
    requests: {
      enabled: typeof r.enabled === "boolean" ? r.enabled : d.requests.enabled,
      delay_days: whole(r.delay_days, LIMITS.delay_days, d.requests.delay_days),
      statuses: statuses.length ? statuses : d.requests.statuses,
      batch: whole(r.batch, LIMITS.batch, d.requests.batch),
      max_age_days: whole(r.max_age_days, LIMITS.max_age_days, d.requests.max_age_days),
      started_at: typeof r.started_at === "string" && !Number.isNaN(Date.parse(r.started_at)) ? r.started_at : null,
    },
    rewards: {
      enabled: typeof w.enabled === "boolean" ? w.enabled : d.rewards.enabled,
      photo_pct: whole(w.photo_pct, LIMITS.photo_pct, d.rewards.photo_pct),
      text_pct: whole(w.text_pct, LIMITS.text_pct, d.rewards.text_pct),
      expiry_days: whole(w.expiry_days, LIMITS.expiry_days, d.rewards.expiry_days),
      cooldown_days: whole(w.cooldown_days, LIMITS.cooldown_days, d.rewards.cooldown_days),
      max_photos: whole(w.max_photos, LIMITS.max_photos, d.rewards.max_photos),
      min_rating: whole(w.min_rating, LIMITS.min_rating, d.rewards.min_rating),
    },
    auto_approve: typeof raw.auto_approve === "boolean" ? raw.auto_approve : d.auto_approve,
    from_name: typeof raw.from_name === "string" && raw.from_name.trim() ? raw.from_name.trim().slice(0, 60) : d.from_name,
  }
}

/**
 * Validate an admin save. Numbers out of range are errors here (not silently
 * clamped) so the owner sees what was wrong.
 */
export function parseReviewProgram(input: unknown): { settings?: ReviewProgram; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, any>
  const check = (group: "requests" | "rewards", key: keyof typeof LIMITS) => {
    const value = raw[group]?.[key]
    if (value === undefined) return
    const [min, max] = LIMITS[key]
    if (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) errors[`${group}.${key}`] = `Use a whole number from ${min} to ${max}.`
  }
  for (const key of ["delay_days", "batch", "max_age_days"] as const) check("requests", key)
  for (const key of ["photo_pct", "text_pct", "expiry_days", "cooldown_days", "max_photos", "min_rating"] as const) check("rewards", key)
  const statuses = raw.requests?.statuses
  if (statuses !== undefined && (!Array.isArray(statuses) || !statuses.length || statuses.some((s: unknown) => !(WORKFLOW_STATUSES as readonly string[]).includes(String(s))))) {
    errors["requests.statuses"] = "Choose at least one order status."
  }
  if (raw.from_name !== undefined && (typeof raw.from_name !== "string" || !raw.from_name.trim() || raw.from_name.length > 60)) {
    errors.from_name = "Enter a sender name within 60 characters."
  }
  return Object.keys(errors).length ? { errors } : { settings: readReviewProgram(raw), errors }
}

export async function loadReviewProgram(container: any): Promise<{ store: any; settings: ReviewProgram }> {
  const [store] = await container.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"], take: 1 })
  return { store, settings: readReviewProgram(store?.metadata?.[REVIEW_PROGRAM_KEY]) }
}

/**
 * Save the programme. Switching requests on for the first time stamps
 * started_at, so orders already delivered before that are not all mailed at
 * once (florayn.com marked its backlog "skipped" the same way).
 */
export async function saveReviewProgram(container: any, next: ReviewProgram): Promise<ReviewProgram> {
  const { store, settings: current } = await loadReviewProgram(container)
  if (!store) throw new Error("Create the store before saving review settings.")
  const settings: ReviewProgram = {
    ...next,
    requests: {
      ...next.requests,
      started_at: next.requests.enabled ? current.requests.started_at ?? new Date().toISOString() : current.requests.started_at,
    },
  }
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { metadata: { ...(store.metadata ?? {}), [REVIEW_PROGRAM_KEY]: settings } } },
  })
  return settings
}
