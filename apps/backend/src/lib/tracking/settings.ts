import crypto from "node:crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { TRACKING_MODULE } from "../../modules/tracking"
import type TrackingModuleService from "../../modules/tracking/service"

/**
 * Ad tracking settings (TRACKING.md section 3): the defaults, the validation
 * of admin patches, the masked admin view, the host-to-destination rule, the
 * public subset the storefront reads, and the cached loaders the rest of
 * lib/tracking uses. One row, id "trackset_default": non-secret settings in
 * its `config` JSON, the ad platform tokens in their own write-only columns.
 * Nothing here logs a token or returns one to a browser.
 */

export const TRACKING_SETTINGS_ID = "trackset_default"

export type Platform = "meta" | "tiktok" | "google"
export type Env = "test" | "live"
export type BrowserMode = "off" | "ads_only" | "all"
export type ImageMode = "jpeg_copies" | "cf_transform"

export type TrackingConfig = {
  v: 1
  test_hosts: string[]
  live_hosts: string[]
  live_armed: boolean
  meta: {
    enabled: boolean
    test_id: string
    live_id: string
    test_event_code: string
    api_version: string
    browser: BrowserMode
    aam_off_confirmed: { test: boolean; live: boolean }
    status_events: { OrderConfirmed: boolean; Delivered: boolean; Returned: boolean }
  }
  tiktok: {
    enabled: boolean
    test_id: string
    live_id: string
    browser: BrowserMode
    /** SPA page views, automatic events AND automatic advanced matching are OFF in both pixels (gates the pixel). */
    spa_off_confirmed: boolean
  }
  google: {
    enabled: boolean
    conversion_id: string
    purchase_label: string
    browser: BrowserMode
  }
  privacy: { share_contact_hashes: boolean; consent_text: string; consent_version: number }
  alerts: {
    enabled: boolean
    email: string
    active_from_hour: number
    active_to_hour: number
    no_purchase_hours: number
    repeat_hours: number
  }
  dashboard: { daily_order_target: number; poll_seconds: number }
  catalog: {
    enabled: boolean
    base_url: string
    image_base_url: string
    image_mode: ImageMode
    shrink_guard_pct: number
    include_case_types: string[]
    exclude_case_types: string[]
  }
}

export const TOKEN_COLUMNS = ["meta_test_token", "meta_live_token", "tiktok_test_token", "tiktok_live_token"] as const
export type TokenColumn = (typeof TOKEN_COLUMNS)[number]

export type TrackingSettingsView = {
  config: TrackingConfig
  tokenSet: { meta: Record<Env, boolean>; tiktok: Record<Env, boolean> }
  feedToken: string | null
}

/** The admin view: `*_set` and `*_masked` for each token, never the token itself. */
export type PresentedTrackingSettings = { config: TrackingConfig; catalog_feed_token: string }
  & { [K in TokenColumn as `${K}_set`]: boolean }
  & { [K in TokenColumn as `${K}_masked`]: string }

/** GET /store/tracking-config (4.5): ids and loading modes only. */
export type PublicTrackingConfig = {
  test_hosts: string[]
  live_hosts: string[]
  live_armed: boolean
  meta: { enabled: boolean; test_id: string; live_id: string; browser: BrowserMode; aam_off_confirmed: { test: boolean; live: boolean } }
  tiktok: { enabled: boolean; test_id: string; live_id: string; browser: BrowserMode; spa_off_confirmed: boolean }
  google: { enabled: boolean; conversion_id: string; purchase_label: string; browser: BrowserMode }
  privacy: { share: boolean; consent_version: number; consent_text: string }
}

export type TrackingPatchResult =
  | { ok: true; config: TrackingConfig; tokens: Partial<Record<TokenColumn, string | null>> }
  | { ok: false; errors: string[] }

type SettingsRow = { id: string; config: unknown } & Record<TokenColumn | "catalog_feed_token", string | null | undefined>

/** TRACKING.md 3.1. Meta and TikTok are off until their tokens are pasted and QA'd. */
export const DEFAULT_CONFIG: TrackingConfig = {
  v: 1,
  test_hosts: ["new.florayn.com"],
  live_hosts: ["florayn.com", "www.florayn.com"],
  live_armed: false,
  meta: {
    enabled: false, test_id: "2247389409441720", live_id: "650439547920083",
    test_event_code: "", api_version: "v26.0", browser: "all",
    aam_off_confirmed: { test: false, live: false },
    status_events: { OrderConfirmed: true, Delivered: true, Returned: true },
  },
  tiktok: {
    enabled: false, test_id: "", live_id: "D9ODDBJC77U97D5Q7MQG", browser: "ads_only",
    spa_off_confirmed: false,
  },
  google: {
    enabled: false, conversion_id: "AW-18147096523", purchase_label: "0p0wCKu2w70cEMvvms1D",
    browser: "ads_only",
  },
  privacy: { share_contact_hashes: false, consent_text: "", consent_version: 1 },
  alerts: {
    enabled: true, email: "floraynweb@gmail.com", active_from_hour: 10, active_to_hour: 24,
    no_purchase_hours: 3, repeat_hours: 6,
  },
  dashboard: { daily_order_target: 300, poll_seconds: 15 },
  catalog: {
    enabled: false, base_url: "https://new.florayn.com", image_base_url: "https://img.florayn.com",
    image_mode: "jpeg_copies", shrink_guard_pct: 20,
    include_case_types: [], exclude_case_types: ["alcantara"],
  },
}

/** Appendix B, offered by "Use suggested wording"; the owner approves it. */
export const SUGGESTED_CONSENT_TEXT = "We use these details to deliver your order. To measure our ads, we also send Meta, TikTok and Google a scrambled (hashed) copy of your phone number, name, district and email."

const BROWSER_MODES: readonly BrowserMode[] = ["off", "ads_only", "all"]
const IMAGE_MODES: readonly ImageMode[] = ["jpeg_copies", "cf_transform"]
const REMOVE = "__remove__"

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asRow(value: unknown): Row {
  if (typeof value === "string") {
    try { return asRow(JSON.parse(value)) } catch { return {} }
  }
  return isRow(value) ? value : {}
}

// ---------------------------------------------------------------- tolerant parse

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function whole(value: unknown, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fallback
}

function choice<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback
}

function list(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : [...fallback]
}

/**
 * The saved config merged over DEFAULT_CONFIG: objects merge, arrays replace,
 * a value of the wrong type (or out of range) falls back to its default and
 * unknown keys are dropped. Never throws.
 */
export function parseTrackingConfig(raw: unknown): TrackingConfig {
  const d = DEFAULT_CONFIG
  const r = asRow(raw)
  const meta = asRow(r.meta)
  const aam = asRow(meta.aam_off_confirmed)
  const statusEvents = asRow(meta.status_events)
  const tiktok = asRow(r.tiktok)
  const google = asRow(r.google)
  const privacy = asRow(r.privacy)
  const alerts = asRow(r.alerts)
  const dashboard = asRow(r.dashboard)
  const catalog = asRow(r.catalog)
  return {
    v: 1,
    test_hosts: list(r.test_hosts, d.test_hosts),
    live_hosts: list(r.live_hosts, d.live_hosts),
    live_armed: bool(r.live_armed, d.live_armed),
    meta: {
      enabled: bool(meta.enabled, d.meta.enabled),
      test_id: text(meta.test_id, d.meta.test_id),
      live_id: text(meta.live_id, d.meta.live_id),
      test_event_code: text(meta.test_event_code, d.meta.test_event_code),
      api_version: text(meta.api_version, d.meta.api_version),
      browser: choice(meta.browser, BROWSER_MODES, d.meta.browser),
      aam_off_confirmed: {
        test: bool(aam.test, d.meta.aam_off_confirmed.test),
        live: bool(aam.live, d.meta.aam_off_confirmed.live),
      },
      status_events: {
        OrderConfirmed: bool(statusEvents.OrderConfirmed, d.meta.status_events.OrderConfirmed),
        Delivered: bool(statusEvents.Delivered, d.meta.status_events.Delivered),
        Returned: bool(statusEvents.Returned, d.meta.status_events.Returned),
      },
    },
    tiktok: {
      enabled: bool(tiktok.enabled, d.tiktok.enabled),
      test_id: text(tiktok.test_id, d.tiktok.test_id),
      live_id: text(tiktok.live_id, d.tiktok.live_id),
      browser: choice(tiktok.browser, BROWSER_MODES, d.tiktok.browser),
      spa_off_confirmed: bool(tiktok.spa_off_confirmed, d.tiktok.spa_off_confirmed),
    },
    google: {
      enabled: bool(google.enabled, d.google.enabled),
      conversion_id: text(google.conversion_id, d.google.conversion_id),
      purchase_label: text(google.purchase_label, d.google.purchase_label),
      browser: choice(google.browser, BROWSER_MODES, d.google.browser),
    },
    privacy: {
      share_contact_hashes: bool(privacy.share_contact_hashes, d.privacy.share_contact_hashes),
      consent_text: text(privacy.consent_text, d.privacy.consent_text),
      consent_version: whole(privacy.consent_version, d.privacy.consent_version, 1, 1_000_000),
    },
    alerts: {
      enabled: bool(alerts.enabled, d.alerts.enabled),
      email: text(alerts.email, d.alerts.email),
      active_from_hour: whole(alerts.active_from_hour, d.alerts.active_from_hour, 0, 24),
      active_to_hour: whole(alerts.active_to_hour, d.alerts.active_to_hour, 0, 24),
      no_purchase_hours: whole(alerts.no_purchase_hours, d.alerts.no_purchase_hours, 1, 12),
      repeat_hours: whole(alerts.repeat_hours, d.alerts.repeat_hours, 1, 48),
    },
    dashboard: {
      daily_order_target: whole(dashboard.daily_order_target, d.dashboard.daily_order_target, 1, 100_000),
      poll_seconds: whole(dashboard.poll_seconds, d.dashboard.poll_seconds, 10, 60),
    },
    catalog: {
      enabled: bool(catalog.enabled, d.catalog.enabled),
      base_url: text(catalog.base_url, d.catalog.base_url),
      image_base_url: text(catalog.image_base_url, d.catalog.image_base_url),
      image_mode: choice(catalog.image_mode, IMAGE_MODES, d.catalog.image_mode),
      shrink_guard_pct: whole(catalog.shrink_guard_pct, d.catalog.shrink_guard_pct, 5, 50),
      include_case_types: list(catalog.include_case_types, d.catalog.include_case_types),
      exclude_case_types: list(catalog.exclude_case_types, d.catalog.exclude_case_types),
    },
  }
}

// ---------------------------------------------------------------- admin patch (3.2)

const DATASET_ID = /^\d{10,20}$/
const TIKTOK_PIXEL = /^[A-Z0-9]{16,24}$/
const CONVERSION_ID = /^AW-\d{6,15}$/
const CONVERSION_LABEL = /^[A-Za-z0-9_-]{10,40}$/
const API_VERSION = /^v\d{2}\.\d$/
const TEST_EVENT_CODE = /^TEST[A-Z0-9]{3,12}$/
const HOST = /^[a-z0-9.-]{1,100}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/
const SLUG = /^[a-z0-9-]{1,40}$/
const TOKEN_TEXT = /^[!-~]{1,512}$/
const CONTROL_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const MAX_HOSTS = 5
const MAX_CASE_TYPES = 50
const MAX_CONSENT = 600

const SECTION_KEYS: Record<string, readonly string[]> = {
  meta: ["enabled", "test_id", "live_id", "test_event_code", "api_version", "browser", "aam_off_confirmed", "status_events"],
  tiktok: ["enabled", "test_id", "live_id", "browser", "spa_off_confirmed"],
  google: ["enabled", "conversion_id", "purchase_label", "browser"],
  privacy: ["share_contact_hashes", "consent_text", "consent_version"],
  alerts: ["enabled", "email", "active_from_hour", "active_to_hour", "no_purchase_hours", "repeat_hours"],
  dashboard: ["daily_order_target", "poll_seconds"],
  catalog: ["enabled", "base_url", "image_base_url", "image_mode", "shrink_guard_pct", "include_case_types", "exclude_case_types"],
}
const TOP_KEYS = new Set<string>(["v", "test_hosts", "live_hosts", "live_armed", ...Object.keys(SECTION_KEYS), ...TOKEN_COLUMNS])

const TOKEN_LABELS: Record<TokenColumn, string> = {
  meta_test_token: "Meta TEST token",
  meta_live_token: "Meta live token",
  tiktok_test_token: "TikTok TEST token",
  tiktok_live_token: "TikTok live token",
}

function isHttpsBase(value: string): boolean {
  if (value.length > 200 || value.endsWith("/") || !value.startsWith("https://")) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && /^[a-z0-9.-]+$/.test(url.hostname)
  } catch {
    return false
  }
}

/**
 * Validates a partial admin patch and returns the whole next config plus the
 * token writes. The body has the config's shape (any subset of sections and
 * keys) plus the four token columns at the top level. Tokens: missing or blank
 * keeps the saved one, "__remove__" clears it, anything else must be one word
 * of printable text up to 512 chars. `privacy.consent_version` is read-only:
 * it goes up by one whenever the consent text changes. Turning
 * `share_contact_hashes` on needs a consent text AND a published Privacy page
 * (C7, I20). Pure: no I/O, never throws, errors never echo a token.
 */
export function parseTrackingPatch(
  body: unknown,
  ctx: { current: TrackingConfig; privacyPublished: boolean }
): TrackingPatchResult {
  if (!isRow(body)) return { ok: false, errors: ["Send the tracking settings as an object."] }
  const input: Row = body
  const errors: string[] = []
  const current = parseTrackingConfig(ctx.current)
  const next = parseTrackingConfig(current)
  const tokens: Partial<Record<TokenColumn, string | null>> = {}

  for (const key of Object.keys(input)) {
    if (!TOP_KEYS.has(key)) errors.push(`Unknown setting "${key}".`)
  }

  function section(name: string): Row | null {
    const value = input[name]
    if (value === undefined) return null
    if (!isRow(value)) {
      errors.push(`"${name}" must be an object.`)
      return null
    }
    for (const key of Object.keys(value)) {
      if (!SECTION_KEYS[name].includes(key)) errors.push(`Unknown setting "${name}.${key}".`)
    }
    return value
  }

  function flag(row: Row, key: string, label: string, set: (value: boolean) => void): void {
    const value = row[key]
    if (value === undefined) return
    if (typeof value === "boolean") set(value)
    else errors.push(`${label} must be on or off.`)
  }

  function pattern(row: Row, key: string, label: string, regex: RegExp, allowEmpty: boolean,
    hint: string, set: (value: string) => void): void {
    const value = row[key]
    if (value === undefined) return
    const trimmed = typeof value === "string" ? value.trim() : null
    if (trimmed !== null && ((allowEmpty && trimmed === "") || regex.test(trimmed))) set(trimmed)
    else errors.push(`${label} ${hint}${allowEmpty ? " (or leave it empty)" : ""}.`)
  }

  function integer(row: Row, key: string, label: string, min: number, max: number,
    set: (value: number) => void): void {
    const value = row[key]
    if (value === undefined) return
    const number = typeof value === "string" && /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) : value
    if (Number.isInteger(number) && (number as number) >= min && (number as number) <= max) set(number as number)
    else errors.push(`${label} must be a whole number from ${min} to ${max}.`)
  }

  function mode<T extends string>(row: Row, key: string, label: string, options: readonly T[],
    set: (value: T) => void): void {
    const value = row[key]
    if (value === undefined) return
    if (options.includes(value as T)) set(value as T)
    else errors.push(`${label} must be one of: ${options.join(", ")}.`)
  }

  function url(row: Row, key: string, label: string, set: (value: string) => void): void {
    const value = row[key]
    if (value === undefined) return
    const trimmed = typeof value === "string" ? value.trim() : ""
    if (isHttpsBase(trimmed)) set(trimmed)
    else errors.push(`${label} must be an https:// address without a trailing slash.`)
  }

  function slugs(row: Row, key: string, label: string, set: (value: string[]) => void): void {
    const value = row[key]
    if (value === undefined) return
    if (!Array.isArray(value) || value.length > MAX_CASE_TYPES) {
      errors.push(`${label} must be a list of up to ${MAX_CASE_TYPES} case type slugs.`)
      return
    }
    const cleaned = value.map((entry) => typeof entry === "string" ? entry.trim().toLowerCase() : "")
    if (cleaned.every((entry) => SLUG.test(entry))) set([...new Set(cleaned)])
    else errors.push(`${label} may only hold case type slugs (a-z, 0-9 and -).`)
  }

  function hosts(key: "test_hosts" | "live_hosts", label: string): void {
    const value = input[key]
    if (value === undefined) return
    if (!Array.isArray(value) || value.length > MAX_HOSTS) {
      errors.push(`${label} must be a list of up to ${MAX_HOSTS} host names.`)
      return
    }
    const cleaned = value.map((entry) => typeof entry === "string" ? entry.trim().toLowerCase() : "")
    if (cleaned.every((entry) => HOST.test(entry))) next[key] = [...new Set(cleaned)]
    else errors.push(`${label} may only hold host names like new.florayn.com (no https://, port or path).`)
  }

  hosts("test_hosts", "Test hosts")
  hosts("live_hosts", "Live hosts")
  flag(input, "live_armed", "Allow live sending", (value) => { next.live_armed = value })

  const meta = section("meta")
  if (meta) {
    flag(meta, "enabled", "Meta", (value) => { next.meta.enabled = value })
    pattern(meta, "test_id", "The Meta TEST dataset id", DATASET_ID, true, "must be 10 to 20 digits", (value) => { next.meta.test_id = value })
    pattern(meta, "live_id", "The Meta live dataset id", DATASET_ID, true, "must be 10 to 20 digits", (value) => { next.meta.live_id = value })
    pattern(meta, "test_event_code", "The Meta test event code", TEST_EVENT_CODE, true, "must look like TEST12345", (value) => { next.meta.test_event_code = value })
    pattern(meta, "api_version", "The Meta API version", API_VERSION, false, "must look like v26.0", (value) => { next.meta.api_version = value })
    mode(meta, "browser", "Meta browser loading", BROWSER_MODES, (value) => { next.meta.browser = value })
    const aam = meta.aam_off_confirmed
    if (aam !== undefined) {
      if (!isRow(aam)) errors.push("\"meta.aam_off_confirmed\" must be an object.")
      else {
        for (const key of Object.keys(aam)) {
          if (key !== "test" && key !== "live") errors.push(`Unknown setting "meta.aam_off_confirmed.${key}".`)
        }
        flag(aam, "test", "Automatic Advanced Matching OFF on the TEST dataset", (value) => { next.meta.aam_off_confirmed.test = value })
        flag(aam, "live", "Automatic Advanced Matching OFF on the live dataset", (value) => { next.meta.aam_off_confirmed.live = value })
      }
    }
    const statusEvents = meta.status_events
    if (statusEvents !== undefined) {
      if (!isRow(statusEvents)) errors.push("\"meta.status_events\" must be an object.")
      else {
        for (const key of Object.keys(statusEvents)) {
          if (!["OrderConfirmed", "Delivered", "Returned"].includes(key)) errors.push(`Unknown setting "meta.status_events.${key}".`)
        }
        flag(statusEvents, "OrderConfirmed", "The OrderConfirmed event", (value) => { next.meta.status_events.OrderConfirmed = value })
        flag(statusEvents, "Delivered", "The Delivered event", (value) => { next.meta.status_events.Delivered = value })
        flag(statusEvents, "Returned", "The Returned event", (value) => { next.meta.status_events.Returned = value })
      }
    }
  }

  const tiktok = section("tiktok")
  if (tiktok) {
    flag(tiktok, "enabled", "TikTok", (value) => { next.tiktok.enabled = value })
    pattern(tiktok, "test_id", "The TikTok TEST pixel code", TIKTOK_PIXEL, true, "must be 16 to 24 capital letters and digits", (value) => { next.tiktok.test_id = value })
    pattern(tiktok, "live_id", "The TikTok live pixel code", TIKTOK_PIXEL, true, "must be 16 to 24 capital letters and digits", (value) => { next.tiktok.live_id = value })
    mode(tiktok, "browser", "TikTok browser loading", BROWSER_MODES, (value) => { next.tiktok.browser = value })
    flag(tiktok, "spa_off_confirmed", "SPA page views and automatic advanced matching OFF in TikTok", (value) => { next.tiktok.spa_off_confirmed = value })
  }

  const google = section("google")
  if (google) {
    flag(google, "enabled", "Google Ads", (value) => { next.google.enabled = value })
    pattern(google, "conversion_id", "The Google conversion id", CONVERSION_ID, false, "must look like AW-123456789", (value) => { next.google.conversion_id = value })
    pattern(google, "purchase_label", "The Google purchase label", CONVERSION_LABEL, false, "must be 10 to 40 letters, digits, - or _", (value) => { next.google.purchase_label = value })
    mode(google, "browser", "Google browser loading", BROWSER_MODES, (value) => { next.google.browser = value })
  }

  const privacy = section("privacy")
  let shareRequested = false
  let textChanged = false
  if (privacy) {
    flag(privacy, "share_contact_hashes", "Share hashed contact details", (value) => {
      next.privacy.share_contact_hashes = value
      shareRequested = value
    })
    const consent = privacy.consent_text
    if (consent !== undefined) {
      const trimmed = typeof consent === "string" ? consent.trim() : null
      if (trimmed === null || trimmed.length > MAX_CONSENT || CONTROL_TEXT.test(trimmed)) {
        errors.push(`The consent sentence must be plain text of at most ${MAX_CONSENT} characters.`)
      } else if (trimmed !== current.privacy.consent_text) {
        next.privacy.consent_text = trimmed
        textChanged = true
      }
    }
    // consent_version is read-only; a value sent back from the GET is ignored.
  }

  const alerts = section("alerts")
  if (alerts) {
    flag(alerts, "enabled", "Alerts", (value) => { next.alerts.enabled = value })
    const email = alerts.email
    if (email !== undefined) {
      const trimmed = typeof email === "string" ? email.trim() : ""
      if (trimmed.length <= 254 && EMAIL.test(trimmed)) next.alerts.email = trimmed
      else errors.push("The alert email must be one email address.")
    }
    integer(alerts, "active_from_hour", "Alerts from (hour)", 0, 24, (value) => { next.alerts.active_from_hour = value })
    integer(alerts, "active_to_hour", "Alerts until (hour)", 0, 24, (value) => { next.alerts.active_to_hour = value })
    integer(alerts, "no_purchase_hours", "The no-purchase window", 1, 12, (value) => { next.alerts.no_purchase_hours = value })
    integer(alerts, "repeat_hours", "Repeat alerts every", 1, 48, (value) => { next.alerts.repeat_hours = value })
  }

  const dashboard = section("dashboard")
  if (dashboard) {
    integer(dashboard, "daily_order_target", "The daily order target", 1, 100_000, (value) => { next.dashboard.daily_order_target = value })
    integer(dashboard, "poll_seconds", "The refresh interval", 10, 60, (value) => { next.dashboard.poll_seconds = value })
  }

  const catalog = section("catalog")
  if (catalog) {
    flag(catalog, "enabled", "The catalog feed", (value) => { next.catalog.enabled = value })
    url(catalog, "base_url", "The shop address", (value) => { next.catalog.base_url = value })
    url(catalog, "image_base_url", "The image address", (value) => { next.catalog.image_base_url = value })
    mode(catalog, "image_mode", "Image mode", IMAGE_MODES, (value) => { next.catalog.image_mode = value })
    integer(catalog, "shrink_guard_pct", "The shrink guard", 5, 50, (value) => { next.catalog.shrink_guard_pct = value })
    slugs(catalog, "include_case_types", "Included case types", (value) => { next.catalog.include_case_types = value })
    slugs(catalog, "exclude_case_types", "Excluded case types", (value) => { next.catalog.exclude_case_types = value })
  }

  for (const column of TOKEN_COLUMNS) {
    const value = input[column]
    if (value === undefined || value === null) continue
    if (typeof value !== "string") {
      errors.push(`${TOKEN_LABELS[column]} must be text.`)
      continue
    }
    const token = value.trim()
    if (!token) continue
    if (token === REMOVE) tokens[column] = null
    else if (TOKEN_TEXT.test(token)) tokens[column] = token
    else errors.push(`${TOKEN_LABELS[column]} must be one piece of text up to 512 characters, without spaces.`)
  }

  const both = next.test_hosts.filter((host) => next.live_hosts.includes(host))
  if (both.length) errors.push(`A host cannot be both a test and a live host: ${both.join(", ")}.`)
  if (next.alerts.active_from_hour >= next.alerts.active_to_hour) {
    errors.push("Alerts must start before they end (from hour lower than until hour).")
  }
  if (textChanged) next.privacy.consent_version = current.privacy.consent_version + 1
  if (shareRequested && !current.privacy.share_contact_hashes) {
    if (!next.privacy.consent_text) errors.push("Add the checkout consent sentence before sharing hashed contact details.")
    if (!ctx.privacyPublished) errors.push("Publish the Privacy page (Admin > Privacy) before sharing hashed contact details.")
  } else if (textChanged && next.privacy.share_contact_hashes && !next.privacy.consent_text) {
    errors.push("The consent sentence cannot be empty while hashed contact details are shared.")
  }

  return errors.length ? { ok: false, errors } : { ok: true, config: next, tokens }
}

// ---------------------------------------------------------------- views

function mask(value: string | null | undefined): string {
  if (!value) return ""
  return value.length > 4 ? `••••••••${value.slice(-4)}` : "••••"
}

/** The admin view of the row: the config plus `*_set` / `*_masked` per token, never a raw token. */
export function present(row: unknown): PresentedTrackingSettings {
  const r = asRow(row)
  const view: Record<string, unknown> = { config: parseTrackingConfig(r.config) }
  for (const column of TOKEN_COLUMNS) {
    const value = typeof r[column] === "string" ? r[column] as string : null
    view[`${column}_set`] = Boolean(value)
    view[`${column}_masked`] = mask(value)
  }
  // The feed token is part of the feed URL the owner copies into Meta/TikTok.
  view.catalog_feed_token = typeof r.catalog_feed_token === "string" ? r.catalog_feed_token : ""
  return view as PresentedTrackingSettings
}

/** Lower case, without a `:port`. */
export function normHost(host: string): string {
  return typeof host === "string" ? host.trim().toLowerCase().replace(/:\d*$/, "") : ""
}

/** TRACKING.md 3.4: test hosts are "test", live hosts are "live" only while armed, other hosts are off. */
export function hostRole(config: TrackingConfig, host: string): Env | null {
  const name = normHost(host)
  if (!name) return null
  if (config.test_hosts.includes(name)) return "test"
  if (config.live_hosts.includes(name)) return config.live_armed ? "live" : "test"
  return null
}

/** Where a platform's events for this host go, or null (off). Google has no test destination. */
export function destinationFor(config: TrackingConfig, host: string, platform: Platform):
  { env: Env; id: string; label?: string } | null {
  const role = hostRole(config, host)
  if (!role) return null
  if (platform === "google") {
    const google = config.google
    if (!google.enabled || role !== "live" || !google.conversion_id || !google.purchase_label) return null
    return { env: "live", id: google.conversion_id, label: google.purchase_label }
  }
  if (platform !== "meta" && platform !== "tiktok") return null
  const settings = config[platform]
  if (!settings.enabled) return null
  const id = role === "live" ? settings.live_id : settings.test_id
  return id ? { env: role, id } : null
}

/** The storefront's copy (4.5): no tokens, alert email, catalog settings or feed token. */
export function publicConfig(config: TrackingConfig): PublicTrackingConfig {
  const share = config.privacy.share_contact_hashes
  return {
    test_hosts: [...config.test_hosts],
    live_hosts: [...config.live_hosts],
    live_armed: config.live_armed,
    meta: {
      enabled: config.meta.enabled, test_id: config.meta.test_id, live_id: config.meta.live_id,
      browser: config.meta.browser,
      aam_off_confirmed: { test: config.meta.aam_off_confirmed.test, live: config.meta.aam_off_confirmed.live },
    },
    tiktok: {
      enabled: config.tiktok.enabled, test_id: config.tiktok.test_id, live_id: config.tiktok.live_id,
      browser: config.tiktok.browser, spa_off_confirmed: config.tiktok.spa_off_confirmed,
    },
    google: {
      enabled: config.google.enabled, conversion_id: config.google.conversion_id,
      purchase_label: config.google.purchase_label, browser: config.google.browser,
    },
    privacy: {
      share,
      consent_version: config.privacy.consent_version,
      consent_text: share ? config.privacy.consent_text : "",
    },
  }
}

/** First 8 hex of sha256: tells a changed token apart without storing it twice. */
export function tokenFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 8)
}

// ---------------------------------------------------------------- the row

const CACHE_MS = 10_000
let cache: { at: number; row: Promise<SettingsRow | null> } | null = null

function trackingService(container: any): TrackingModuleService {
  return container.resolve(TRACKING_MODULE)
}

/** The singleton, read by its fixed id (uncached), or null before the first save. */
export async function readTrackingSettingsRow(container: any): Promise<SettingsRow | null> {
  const [row] = await trackingService(container).listTrackingSettings({ id: TRACKING_SETTINGS_ID }, { take: 1 })
  return (row as unknown as SettingsRow) ?? null
}

/**
 * The singleton, created on first use. A concurrent first save can make the
 * create fail on the primary key; that is recovered by reading the row the
 * other request made (update-checkout-settings.ts). Never list-take-1-then-create.
 */
export async function ensureTrackingSettingsRow(container: any): Promise<SettingsRow> {
  const existing = await readTrackingSettingsRow(container)
  if (existing) return existing
  try {
    const created = await trackingService(container).createTrackingSettings({ id: TRACKING_SETTINGS_ID, config: {} })
    return created as unknown as SettingsRow
  } catch (error) {
    const created = await readTrackingSettingsRow(container)
    if (!created) throw error
    return created
  }
}

function cachedRow(container: any): Promise<SettingsRow | null> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.row
  const entry = { at: now, row: readTrackingSettingsRow(container) }
  cache = entry
  // A failed read is not cached; the caller still sees the error.
  entry.row.catch(() => { if (cache === entry) cache = null })
  return entry.row
}

/** Drops the in-process copy; the next read goes to the database. */
export function invalidateTrackingSettings(): void {
  cache = null
}

/** Config, which tokens exist and the feed token, cached for 10 s per process. Missing row = defaults. */
export async function loadTrackingSettings(container: any): Promise<TrackingSettingsView> {
  const row = await cachedRow(container)
  return {
    config: parseTrackingConfig(row?.config),
    tokenSet: {
      meta: { test: Boolean(row?.meta_test_token), live: Boolean(row?.meta_live_token) },
      tiktok: { test: Boolean(row?.tiktok_test_token), live: Boolean(row?.tiktok_live_token) },
    },
    feedToken: row?.catalog_feed_token || null,
  }
}

/** A platform token. Only the outbox sender and the test-event route may call this. */
export async function loadTrackingToken(container: any, platform: "meta" | "tiktok", env: Env): Promise<string | null> {
  const row = await cachedRow(container)
  const value = row?.[`${platform}_${env}_token` as TokenColumn]
  return typeof value === "string" && value ? value : null
}

/**
 * Writes token columns straight through the module service (3.3, I16): a
 * workflow could checkpoint its input to Redis and workflow_execution, so
 * secrets never pass through one.
 */
export async function saveTrackingTokens(container: any, tokens: Partial<Record<TokenColumn, string | null>>): Promise<void> {
  const patch: Partial<Record<TokenColumn, string | null>> = {}
  for (const column of TOKEN_COLUMNS) {
    if (column in tokens) patch[column] = tokens[column] ?? null
  }
  if (!Object.keys(patch).length) return
  await ensureTrackingSettingsRow(container)
  await trackingService(container).updateTrackingSettings({ id: TRACKING_SETTINGS_ID, ...patch })
  invalidateTrackingSettings()
}

async function writeFeedToken(container: any): Promise<string> {
  const token = crypto.randomBytes(24).toString("base64url")
  await trackingService(container).updateTrackingSettings({ id: TRACKING_SETTINGS_ID, catalog_feed_token: token })
  invalidateTrackingSettings()
  const saved = await readTrackingSettingsRow(container)
  return saved?.catalog_feed_token || token
}

/** The catalog feed token (32 url-safe chars), generated and saved when missing. */
export async function ensureFeedToken(container: any): Promise<string> {
  const row = await ensureTrackingSettingsRow(container)
  if (row.catalog_feed_token) return row.catalog_feed_token
  return writeFeedToken(container)
}

/** A new feed token; the old feed URL stops working at once. */
export async function rotateFeedToken(container: any): Promise<string> {
  await ensureTrackingSettingsRow(container)
  return writeFeedToken(container)
}

/**
 * Whether the Privacy page is published (WP09's privacy_setting). A missing
 * table or row, or any error, counts as unpublished, so sharing stays off.
 */
export async function isPrivacyPublished(container: any): Promise<boolean> {
  try {
    const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const result = await knex.raw(
      "select published from privacy_setting where id = ? and deleted_at is null",
      ["privacyset_default"]
    )
    return result?.rows?.[0]?.published === true
  } catch {
    return false
  }
}
