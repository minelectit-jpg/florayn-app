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
  /** WhatsApp, for customers who ordered with only a phone number. */
  whatsapp: {
    /** Review requests on WhatsApp: never, for orders without an email, or with every email too. */
    requests: WhatsAppPolicy
    /** Send a review's code on WhatsApp when the reviewer has no email. */
    rewards: boolean
    /** The approved templates' names and language in WhatsApp Manager. */
    request_template: string
    reward_template: string
    language: string
    /**
     * What the admin's "WhatsApp" button types into the chat, to send by hand
     * from the shop's own WhatsApp. {name} {product} {link} {photo_pct}
     * {text_pct}; lines with a % are left out while rewards are off.
     */
    manual_request_text: string
    /** {name} {code} {pct} {until} {shop} */
    manual_reward_text: string
  }
}

export const WHATSAPP_POLICIES = ["off", "no_email", "always"] as const
export type WhatsAppPolicy = (typeof WHATSAPP_POLICIES)[number]

export const DEFAULT_MANUAL_REQUEST_TEXT = [
  "Hi {name}! Thank you for shopping with Florayn. How do you like your {product}?",
  "We would love a quick review: {link}",
  "Add a photo with your review and get {photo_pct}% off your next order ({text_pct}% for a few words).",
].join("\n")

export const DEFAULT_MANUAL_REWARD_TEXT = [
  "Hi {name}, thank you for your review!",
  "Here is your {pct}% off code for your next Florayn order: {code}",
  "It works once{until}. Shop: {shop}",
].join("\n")

export const DEFAULT_REVIEW_PROGRAM: ReviewProgram = {
  requests: { enabled: false, delay_days: 4, statuses: ["delivered"], batch: 40, max_age_days: 120, started_at: null },
  rewards: { enabled: true, photo_pct: 15, text_pct: 10, expiry_days: 60, cooldown_days: 30, max_photos: 3, min_rating: 1 },
  auto_approve: false,
  from_name: "Florayn",
  whatsapp: {
    requests: "no_email",
    rewards: true,
    request_template: "florayn_review_request",
    reward_template: "florayn_review_reward",
    language: "en",
    manual_request_text: DEFAULT_MANUAL_REQUEST_TEXT,
    manual_reward_text: DEFAULT_MANUAL_REWARD_TEXT,
  },
}

const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/

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
  const wa = raw.whatsapp ?? {}
  const d = DEFAULT_REVIEW_PROGRAM
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : fallback)
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
    whatsapp: {
      requests: (WHATSAPP_POLICIES as readonly string[]).includes(wa.requests) ? wa.requests : d.whatsapp.requests,
      rewards: typeof wa.rewards === "boolean" ? wa.rewards : d.whatsapp.rewards,
      request_template: TEMPLATE_NAME.test(wa.request_template ?? "") ? wa.request_template : d.whatsapp.request_template,
      reward_template: TEMPLATE_NAME.test(wa.reward_template ?? "") ? wa.reward_template : d.whatsapp.reward_template,
      language: LANGUAGE.test(wa.language ?? "") ? wa.language : d.whatsapp.language,
      manual_request_text: text(wa.manual_request_text, d.whatsapp.manual_request_text),
      manual_reward_text: text(wa.manual_reward_text, d.whatsapp.manual_reward_text),
    },
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
  const wa = raw.whatsapp
  if (wa !== undefined) {
    if (wa.requests !== undefined && !(WHATSAPP_POLICIES as readonly string[]).includes(wa.requests)) errors["whatsapp.requests"] = "Choose when to use WhatsApp."
    for (const key of ["request_template", "reward_template"] as const) {
      if (wa[key] !== undefined && !TEMPLATE_NAME.test(String(wa[key]))) errors[`whatsapp.${key}`] = "Use lower-case letters, digits and _ only, as in WhatsApp Manager."
    }
    if (wa.language !== undefined && !LANGUAGE.test(String(wa.language))) errors["whatsapp.language"] = "Use a language code such as en or en_US."
    for (const key of ["manual_request_text", "manual_reward_text"] as const) {
      if (wa[key] !== undefined && (typeof wa[key] !== "string" || !wa[key].trim() || wa[key].length > 1000)) errors[`whatsapp.${key}`] = "Write the message (up to 1,000 characters)."
    }
    if (typeof wa.manual_request_text === "string" && !wa.manual_request_text.includes("{link}")) errors["whatsapp.manual_request_text"] = "Keep {link} in the message: it is the review link."
    if (typeof wa.manual_reward_text === "string" && !wa.manual_reward_text.includes("{code}")) errors["whatsapp.manual_reward_text"] = "Keep {code} in the message."
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
