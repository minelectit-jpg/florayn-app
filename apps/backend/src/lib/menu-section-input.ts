import { DEVICE_FAMILIES, type DeviceFamilyKey } from "./storefront-presentation"

/**
 * Admin > Navigation: what a header menu section may be saved as. Pure, so the
 * write routes and the one-off data script share one set of rules; anything
 * that needs the database (the case types that exist) is passed in.
 *
 *   links        the hand-made groups of links (menu_item rows); config null
 *   devices      { families: ordered, non-empty, unique; case_type: slug | null }
 *   case_types   { form: phone | airpods | watch | wallet; exclude: slugs; links: { slug: href } }
 *   collections  { title (40 chars); view_all_href; limit 1-12 }
 *
 * The footer is always links, shown everywhere.
 */

export const MENU_KINDS = ["links", "devices", "case_types", "collections"] as const
export type MenuKind = typeof MENU_KINDS[number]
export const MENU_PLACEMENTS = ["all", "drawer", "bar"] as const
export type MenuPlacement = typeof MENU_PLACEMENTS[number]
export const PRODUCT_FORMS = ["phone", "airpods", "watch", "wallet"] as const
export type ProductForm = typeof PRODUCT_FORMS[number]

export type DevicesSectionConfig = { families: DeviceFamilyKey[]; case_type: string | null }
export type CaseTypesSectionConfig = { form: ProductForm; exclude: string[]; links: Record<string, string> }
export type CollectionsSectionConfig = { title: string; view_all_href: string; limit: number }
export type MenuSectionConfig = DevicesSectionConfig | CaseTypesSectionConfig | CollectionsSectionConfig

/** The admin's wording for every rejection, so the screen can show it as is. */
export const MENU_SECTION_MESSAGES = {
  kind: "Type must be Links, Device models, Case styles or Collections row.",
  badge: "Badge must be 12 characters or fewer.",
  image: "Use an https image link (pick one from the media library).",
  families: "Pick at least one brand.",
  family: "Pick brands from the list.",
  caseType: "That case type does not exist.",
  href: "Use a site path like /collection/leopard/ or a full https link.",
  limit: "Show between 1 and 12 collections.",
  placement: "Choose where the section shows.",
  form: "Choose Phone, AirPods, Watch or Wallet.",
  title: "Keep the title to 40 characters or fewer.",
} as const

const BADGE_MAX = 12
const TITLE_MAX = 40
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const DEFAULT_COLLECTIONS_CONFIG: CollectionsSectionConfig = { title: "Collections", view_all_href: "/collections/", limit: 8 }

/** A section's settings when it is switched to a kind and none are sent. */
export function defaultMenuConfig(kind: MenuKind): MenuSectionConfig | null {
  if (kind === "devices") return { families: ["iphone", "samsung"], case_type: null }
  if (kind === "case_types") return { form: "phone", exclude: [], links: {} }
  if (kind === "collections") return { ...DEFAULT_COLLECTIONS_CONFIG }
  return null
}

/** A site path (/collection/leopard/) or a full https link; never javascript:, // or http:. */
export function safeMenuHref(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 500 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return false
  if (value.startsWith("/")) return !value.startsWith("//")
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

/** Trimmed, 12 characters or fewer; blank (or null) clears it. */
export function sanitizeBadge(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new Error(MENU_SECTION_MESSAGES.badge)
  const badge = value.trim()
  if (badge.length > BADGE_MAX) throw new Error(MENU_SECTION_MESSAGES.badge)
  return badge || null
}

/** Null, or an https picture link. */
export function sanitizeImageUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new Error(MENU_SECTION_MESSAGES.image)
  const url = value.trim()
  if (!url) return null
  if (!safeMenuHref(url) || !url.startsWith("https://")) throw new Error(MENU_SECTION_MESSAGES.image)
  return url
}

export function sanitizeKind(value: unknown): MenuKind {
  if (!MENU_KINDS.includes(value as MenuKind)) throw new Error(MENU_SECTION_MESSAGES.kind)
  return value as MenuKind
}

export function sanitizePlacement(value: unknown): MenuPlacement {
  if (!MENU_PLACEMENTS.includes(value as MenuPlacement)) throw new Error(MENU_SECTION_MESSAGES.placement)
  return value as MenuPlacement
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function devicesConfig(value: unknown, caseTypes: readonly string[]): DevicesSectionConfig {
  const v = record(value)
  if (!Array.isArray(v.families) || !v.families.length) throw new Error(MENU_SECTION_MESSAGES.families)
  const families: DeviceFamilyKey[] = []
  for (const family of v.families) {
    if (!DEVICE_FAMILIES.includes(family as DeviceFamilyKey)) throw new Error(MENU_SECTION_MESSAGES.family)
    if (!families.includes(family as DeviceFamilyKey)) families.push(family as DeviceFamilyKey)
  }
  let case_type: string | null = null
  if (typeof v.case_type === "string" && v.case_type.trim()) {
    case_type = v.case_type.trim()
    if (!caseTypes.includes(case_type)) throw new Error(MENU_SECTION_MESSAGES.caseType)
  } else if (v.case_type !== undefined && v.case_type !== null && v.case_type !== "") {
    throw new Error(MENU_SECTION_MESSAGES.caseType)
  }
  return { families, case_type }
}

function caseTypesConfig(value: unknown): CaseTypesSectionConfig {
  const v = record(value)
  if (v.form !== undefined && v.form !== null && !PRODUCT_FORMS.includes(v.form as ProductForm)) throw new Error(MENU_SECTION_MESSAGES.form)
  const form = (v.form ?? "phone") as ProductForm
  const exclude = [...new Set((Array.isArray(v.exclude) ? v.exclude : [])
    .filter((slug): slug is string => typeof slug === "string" && SLUG.test(slug.trim()))
    .map((slug) => slug.trim()))]
  const links: Record<string, string> = {}
  for (const [slug, raw] of Object.entries(record(v.links))) {
    const href = typeof raw === "string" ? raw.trim() : ""
    if (!SLUG.test(slug) || !href) continue
    if (!safeMenuHref(href)) throw new Error(MENU_SECTION_MESSAGES.href)
    links[slug] = href
  }
  return { form, exclude, links }
}

function collectionsConfig(value: unknown): CollectionsSectionConfig {
  const v = record(value)
  if (v.title !== undefined && v.title !== null && typeof v.title !== "string") throw new Error(MENU_SECTION_MESSAGES.title)
  const title = typeof v.title === "string" && v.title.trim() ? v.title.trim() : DEFAULT_COLLECTIONS_CONFIG.title
  if (title.length > TITLE_MAX) throw new Error(MENU_SECTION_MESSAGES.title)
  const rawHref = typeof v.view_all_href === "string" ? v.view_all_href.trim() : ""
  const view_all_href = rawHref || DEFAULT_COLLECTIONS_CONFIG.view_all_href
  if (!safeMenuHref(view_all_href)) throw new Error(MENU_SECTION_MESSAGES.href)
  const limit = v.limit === undefined || v.limit === null || v.limit === "" ? DEFAULT_COLLECTIONS_CONFIG.limit : Number(v.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error(MENU_SECTION_MESSAGES.limit)
  return { title, view_all_href, limit }
}

/** One kind's settings, checked and filled with defaults. `caseTypes` = the active case-type slugs. */
export function sanitizeMenuConfig(kind: MenuKind, value: unknown, caseTypes: readonly string[]): MenuSectionConfig | null {
  if (kind === "devices") return devicesConfig(value, caseTypes)
  if (kind === "case_types") return caseTypesConfig(value)
  if (kind === "collections") return collectionsConfig(value)
  return null
}

export type MenuSectionPatch = {
  kind?: MenuKind
  image_url?: string | null
  badge?: string | null
  placement?: MenuPlacement
  config?: MenuSectionConfig | null
}

export type MenuSectionContext = {
  /** The section's menu: primary, primary-men or footer. */
  menu: string
  /** The saved kind (null or absent for a new section: links). */
  kind?: string | null
  /** The active case-type slugs, for a devices section's case type. */
  caseTypes: readonly string[]
}

/**
 * The typed fields of a create or edit body (kind, image_url, badge, placement,
 * config) as a patch holding only what was sent. Switching kind without
 * settings starts that kind's defaults. Throws with the admin's message.
 */
export function sanitizeMenuSectionInput(body: Record<string, unknown>, context: MenuSectionContext): MenuSectionPatch {
  const patch: MenuSectionPatch = {}
  if (body.badge !== undefined) patch.badge = sanitizeBadge(body.badge)
  if (body.image_url !== undefined) patch.image_url = sanitizeImageUrl(body.image_url)

  if (context.menu === "footer") {
    if (body.kind !== undefined || body.placement !== undefined || body.config !== undefined) {
      patch.kind = "links"
      patch.placement = "all"
      patch.config = null
    }
    return patch
  }

  const saved: MenuKind = MENU_KINDS.includes(context.kind as MenuKind) ? context.kind as MenuKind : "links"
  const kind = body.kind !== undefined ? sanitizeKind(body.kind) : saved
  if (body.kind !== undefined) patch.kind = kind
  if (body.config !== undefined) patch.config = sanitizeMenuConfig(kind, body.config, context.caseTypes)
  else if (kind !== saved) patch.config = defaultMenuConfig(kind)
  if (body.placement !== undefined) patch.placement = sanitizePlacement(body.placement)
  return patch
}

/** Whether saving this body needs the case-type list (a devices config is checked). */
export function needsCaseTypes(body: Record<string, unknown>, savedKind?: string | null): boolean {
  return body.config !== undefined && (body.kind ?? savedKind) === "devices"
}
