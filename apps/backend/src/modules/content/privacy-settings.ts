/**
 * The Privacy page (/privacy/): one plain-text document Florayn edits in
 * Admin > Privacy. It stays unpublished until Florayn has checked the wording.
 * While it is unpublished the storefront keeps its placeholder, and Admin >
 * Tracking refuses to share hashed contact details (TRACKING.md C7); that
 * check reads `privacy_setting.published` for this row directly.
 */
import type { MedusaContainer } from "@medusajs/framework/types"

import { CONTENT_MODULE } from "./index"
import type ContentModuleService from "./service"

export type PrivacySettings = {
  title: string
  body: string
  published: boolean
  updated_at: string | null
}

export type PrivacyPatch = Partial<Pick<PrivacySettings, "title" | "body" | "published">>

export const PRIVACY_SETTINGS_ID = "privacyset_default"

export const DEFAULT_PRIVACY_SETTINGS: Pick<PrivacySettings, "title" | "body" | "published"> = {
  title: "Privacy policy",
  body: "",
  published: false,
}

export const PRIVACY_LIMITS = { title: 120, body: 20_000 } as const

// Plain text only, as on Contact: no markup, control or bidi override characters.
const UNSAFE_TEXT = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/
const EDITABLE = ["title", "body", "published"]

function plainText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.replace(/\r\n?/g, "\n").trim()
  return text.length > max || UNSAFE_TEXT.test(text) ? undefined : text
}

function isoDate(value: unknown): string | null {
  // Duck-typed so a Date from another realm (tests, the ORM) still counts.
  const dated = typeof value === "string" || Object.prototype.toString.call(value) === "[object Date]"
  const time = dated ? new Date(value as string | Date).getTime() : NaN
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** The display fields of a stored row; a missing or malformed value falls back. */
export function present(row?: unknown): PrivacySettings {
  const source = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {}
  const title = plainText(source.title, PRIVACY_LIMITS.title) || DEFAULT_PRIVACY_SETTINGS.title
  const body = plainText(source.body, PRIVACY_LIMITS.body) ?? DEFAULT_PRIVACY_SETTINGS.body
  // A page without text is never reported as published.
  const published = source.published === true && body !== ""
  return { title, body, published, updated_at: isoDate(source.updated_at) }
}

/**
 * Strict patch. `current` is the saved page, so publishing needs text and a
 * published page cannot be emptied.
 */
export function parsePrivacyPatch(
  input: unknown,
  current: Pick<PrivacySettings, "body" | "published"> = DEFAULT_PRIVACY_SETTINGS
):
  | { ok: true; patch: PrivacyPatch }
  | { ok: false; errors: Record<string, string> } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { form: "Expected privacy page settings." } }
  }
  const body = input as Record<string, unknown>
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)
  const patch: PrivacyPatch = {}
  const errors: Record<string, string> = {}
  if (!Object.keys(body).length) errors.form = "No privacy page settings provided."
  if (Object.keys(body).some((key) => !EDITABLE.includes(key))) {
    errors.form = "Only the privacy page title, text and published switch can be edited here."
  }
  if (has("title")) {
    const title = plainText(body.title, PRIVACY_LIMITS.title)
    if (!title) errors.title = `Use 1-${PRIVACY_LIMITS.title} characters of plain text without < or >.`
    else patch.title = title
  }
  if (has("body")) {
    const text = plainText(body.body, PRIVACY_LIMITS.body)
    if (text === undefined) errors.body = "Use up to 20,000 characters of plain text without < or >."
    else patch.body = text
  }
  if (has("published")) {
    if (typeof body.published !== "boolean") errors.published = "Choose whether the page is published."
    else patch.published = body.published
  }
  if (!errors.body && !errors.published && (patch.published ?? current.published) && !(patch.body ?? current.body)) {
    errors.published = "Write the policy before publishing it, or unpublish the page first."
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, patch }
}

/** Reads never insert the singleton: a missing row reads as the defaults. */
export async function readPrivacySettings(container: Pick<MedusaContainer, "resolve">): Promise<PrivacySettings> {
  const service: ContentModuleService = container.resolve(CONTENT_MODULE)
  const [row] = await service.listPrivacySettings({ id: PRIVACY_SETTINGS_ID }, { take: 1 })
  return present(row)
}
