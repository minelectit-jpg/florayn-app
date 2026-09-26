import { MEDUSA_BACKEND_URL, MEDUSA_PUBLISHABLE_KEY } from "../../medusa"
import { assertServer } from "./guard"
import { isStaffCookie } from "./keys"

assertServer()

/**
 * The storefront's copy of the tracking settings (TRACKING.md 3.4, 4.2, 4.5):
 * the public subset GET /store/tracking-config returns, and the host rules the
 * backend applies to the same config. hostRole and destinationFor are
 * identical to apps/backend/src/lib/tracking/settings.ts and both are tested
 * against the Appendix C host_role and destination vectors. Any fetch or
 * parse error gives the defaults of 3.1, where every platform is off.
 */
export type Platform = "meta" | "tiktok" | "google"
export type Env = "test" | "live"
export type BrowserMode = "off" | "ads_only" | "all"

export type PublicTrackingConfig = {
  test_hosts: string[]
  live_hosts: string[]
  live_armed: boolean
  meta: { enabled: boolean; test_id: string; live_id: string; browser: BrowserMode; aam_off_confirmed: { test: boolean; live: boolean } }
  tiktok: { enabled: boolean; test_id: string; live_id: string; browser: BrowserMode; spa_off_confirmed: boolean }
  google: { enabled: boolean; conversion_id: string; purchase_label: string; browser: BrowserMode }
  privacy: { share: boolean; consent_version: number; consent_text: string }
}

export type Destination = { env: Env; id: string; label?: string }

export type Pixels = {
  meta: { id: string; load: boolean } | null
  tiktok: { id: string; load: boolean } | null
  google: { id: string; label: string; load: boolean } | null
}

/** The public subset of DEFAULT_CONFIG (3.1): every platform disabled, nothing shared. */
export const DEFAULT_TRACKING_CONFIG: PublicTrackingConfig = {
  test_hosts: ["new.florayn.com"],
  live_hosts: ["florayn.com", "www.florayn.com"],
  live_armed: false,
  meta: {
    enabled: false, test_id: "2247389409441720", live_id: "650439547920083", browser: "all",
    aam_off_confirmed: { test: false, live: false },
  },
  tiktok: { enabled: false, test_id: "", live_id: "D9ODDBJC77U97D5Q7MQG", browser: "ads_only", spa_off_confirmed: false },
  google: { enabled: false, conversion_id: "AW-18147096523", purchase_label: "0p0wCKu2w70cEMvvms1D", browser: "ads_only" },
  privacy: { share: false, consent_version: 1, consent_text: "" },
}

type Row = Record<string, unknown>

function row(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {}
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function mode(value: unknown, fallback: BrowserMode): BrowserMode {
  return value === "off" || value === "ads_only" || value === "all" ? value : fallback
}

function hosts(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return value.filter((host): host is string => typeof host === "string").map(normHost).filter(Boolean)
}

/** The /store/tracking-config body merged over the defaults; junk values fall back one by one. */
export function parsePublicConfig(raw: unknown): PublicTrackingConfig {
  const source = row(raw)
  const base = DEFAULT_TRACKING_CONFIG
  const meta = row(source.meta)
  const aam = row(meta.aam_off_confirmed)
  const tiktok = row(source.tiktok)
  const google = row(source.google)
  const privacy = row(source.privacy)
  const version = privacy.consent_version
  return {
    test_hosts: hosts(source.test_hosts, base.test_hosts),
    live_hosts: hosts(source.live_hosts, base.live_hosts),
    live_armed: flag(source.live_armed, base.live_armed),
    meta: {
      enabled: flag(meta.enabled, base.meta.enabled),
      test_id: text(meta.test_id, base.meta.test_id),
      live_id: text(meta.live_id, base.meta.live_id),
      browser: mode(meta.browser, base.meta.browser),
      aam_off_confirmed: {
        test: flag(aam.test, base.meta.aam_off_confirmed.test),
        live: flag(aam.live, base.meta.aam_off_confirmed.live),
      },
    },
    tiktok: {
      enabled: flag(tiktok.enabled, base.tiktok.enabled),
      test_id: text(tiktok.test_id, base.tiktok.test_id),
      live_id: text(tiktok.live_id, base.tiktok.live_id),
      browser: mode(tiktok.browser, base.tiktok.browser),
      spa_off_confirmed: flag(tiktok.spa_off_confirmed, base.tiktok.spa_off_confirmed),
    },
    google: {
      enabled: flag(google.enabled, base.google.enabled),
      conversion_id: text(google.conversion_id, base.google.conversion_id),
      purchase_label: text(google.purchase_label, base.google.purchase_label),
      browser: mode(google.browser, base.google.browser),
    },
    privacy: {
      share: flag(privacy.share, base.privacy.share),
      consent_version: Number.isSafeInteger(version) && (version as number) >= 1 ? version as number : base.privacy.consent_version,
      consent_text: text(privacy.consent_text, base.privacy.consent_text),
    },
  }
}

/**
 * The settings, cached in Next's data cache for 5 minutes and busted by the
 * `content:tracking` tag when an admin saves them (the lib/checkout.ts
 * pattern). Never throws.
 */
export async function getTrackingConfig(): Promise<PublicTrackingConfig> {
  try {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/store/tracking-config`, {
      headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY },
      next: { revalidate: 300, tags: ["content", "content:tracking"] },
    })
    if (!res.ok) return parsePublicConfig(null)
    const data = await res.json() as { config?: unknown }
    return parsePublicConfig(data?.config)
  } catch {
    return parsePublicConfig(null)
  }
}

/** Lower case, without a `:port`. */
export function normHost(host: string): string {
  return typeof host === "string" ? host.trim().toLowerCase().replace(/:\d*$/, "") : ""
}

/** Test hosts are "test", live hosts are "live" only while armed, other hosts are off (null). */
export function hostRole(config: PublicTrackingConfig, host: string): Env | null {
  const name = normHost(host)
  if (!name) return null
  if (config.test_hosts.includes(name)) return "test"
  if (config.live_hosts.includes(name)) return config.live_armed ? "live" : "test"
  return null
}

/** Where a platform's events for this host go, or null (off). Google has no test destination. */
export function destinationFor(config: PublicTrackingConfig, host: string, platform: Platform): Destination | null {
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

/**
 * Which vendor scripts this browser may load (4.2). A platform needs a
 * destination here and a browser mode other than "off"; Meta also needs
 * Automatic Advanced Matching confirmed off for that dataset, TikTok needs its
 * SPA page views confirmed off, and "ads_only" needs the platform's click
 * cookie (already present or set by this response, `justSet`). Staff and
 * opted-out browsers load nothing.
 */
export function pixelsFor(config: PublicTrackingConfig, host: string, cookies: Record<string, string>,
  justSet: readonly string[] = []): Pixels {
  const excluded = isStaffCookie(cookies._fl_staff) || Boolean(cookies._fl_optout)
  const has = (name: string) => Boolean(cookies[name]) || justSet.includes(name)
  const allowed = (browser: BrowserMode, clickCookie: string) =>
    !excluded && browser !== "off" && (browser === "all" || has(clickCookie))

  const meta = destinationFor(config, host, "meta")
  const tiktok = destinationFor(config, host, "tiktok")
  const google = destinationFor(config, host, "google")
  return {
    meta: meta ? {
      id: meta.id,
      load: allowed(config.meta.browser, "_fbc") && config.meta.aam_off_confirmed[meta.env] === true,
    } : null,
    tiktok: tiktok ? {
      id: tiktok.id,
      load: allowed(config.tiktok.browser, "ttclid") && config.tiktok.spa_off_confirmed,
    } : null,
    google: google ? {
      id: google.id,
      label: google.label ?? "",
      load: allowed(config.google.browser, "_fl_gclid"),
    } : null,
  }
}

/** The consent line under Place order (Appendix B), only while hashed contact details are shared. */
export function checkoutConsent(config: PublicTrackingConfig): { text: string; version: number } | null {
  const text = config.privacy.consent_text.trim()
  return config.privacy.share && text ? { text, version: config.privacy.consent_version } : null
}
