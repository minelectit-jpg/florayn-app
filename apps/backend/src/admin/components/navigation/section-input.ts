import { DEVICE_FAMILIES, type DeviceFamilyKey } from "../../../lib/storefront-presentation"

/*
 * Admin > Navigation: the typed header sections, their settings per type and
 * the same checks the server runs (lib/menu-section-input.ts), so a mistake is
 * caught before the request and the message matches the server's 400.
 */

export type MenuKind = "links" | "devices" | "case_types" | "collections"
export type MenuPlacement = "all" | "drawer" | "bar"
export type ProductForm = "phone" | "airpods" | "watch" | "wallet"
export type DevicesConfig = { families: DeviceFamilyKey[]; case_type: string | null }
export type CaseTypesConfig = { form: ProductForm; exclude: string[]; links: Record<string, string> }
export type CollectionsConfig = { title: string; view_all_href: string; limit: number }
export type SectionConfig = DevicesConfig | CaseTypesConfig | CollectionsConfig

/** A menu_section row as /admin/content returns it. Older rows have no kind. */
export type AdminMenuSection = {
  id: string
  menu: string
  label: string
  href: string | null
  position: number
  is_visible: boolean
  kind?: MenuKind | null
  image_url?: string | null
  badge?: string | null
  placement?: MenuPlacement | null
  config?: unknown
}

export type CatalogDevice = { id: string; slug: string; name: string; family: string; is_active: boolean; badge?: string | null }
export type CatalogCaseType = { id: string; slug: string; name: string; is_active: boolean; image_url: string | null; devices: { family: string }[] }

export const KIND_OPTIONS: { value: MenuKind; label: string }[] = [
  { value: "links", label: "Links" },
  { value: "devices", label: "Device models (automatic)" },
  { value: "case_types", label: "Case styles (automatic)" },
  { value: "collections", label: "Collections row (automatic)" },
]
export const PLACEMENT_OPTIONS: { value: MenuPlacement; label: string }[] = [
  { value: "all", label: "Phone menu and desktop bar" },
  { value: "drawer", label: "Phone menu only" },
  { value: "bar", label: "Desktop bar only" },
]
export const FORM_OPTIONS: { value: ProductForm; label: string }[] = [
  { value: "phone", label: "Phone" },
  { value: "airpods", label: "AirPods" },
  { value: "watch", label: "Watch" },
  { value: "wallet", label: "Wallet" },
]
/** The admin's names for the device families (the store's names are in Navigation settings). */
export const FAMILY_NAMES: Record<DeviceFamilyKey, string> = {
  iphone: "iPhone",
  samsung: "Samsung Galaxy",
  airpods: "AirPods",
  watch: "Apple Watch",
  wallet: "Wallets",
}

export const MESSAGES = {
  kind: "Type must be Links, Device models, Case styles or Collections row.",
  badge: "Badge must be 12 characters or fewer.",
  image: "Use an https image link (pick one from the media library).",
  families: "Pick at least one brand.",
  caseType: "That case type does not exist.",
  href: "Use a site path like /collection/leopard/ or a full https link.",
  limit: "Show between 1 and 12 collections.",
  label: "Give the section a label.",
  placement: "Choose where the section shows.",
  title: "Keep the title to 40 characters or fewer.",
}

const KINDS = KIND_OPTIONS.map((o) => o.value)
const PLACEMENTS = PLACEMENT_OPTIONS.map((o) => o.value)
const FORMS = FORM_OPTIONS.map((o) => o.value)
const BADGE_MAX = 12
const TITLE_MAX = 40

const isFamily = (value: unknown): value is DeviceFamilyKey => (DEVICE_FAMILIES as readonly unknown[]).includes(value)
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** A site path (/collection/leopard/) or a full https link; never //host, javascript: or spaces. */
export function safeMenuHref(value: string): boolean {
  if (!value || /[\s\u0000-\u001f\u007f\\]/.test(value)) return false
  if (value.startsWith("/")) return !value.startsWith("//")
  return isHttps(value)
}
export function isHttps(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}

/** iPhone and Samsung are one product form, "phone"; the others are their own. */
export function formOfFamily(family: unknown): ProductForm | null {
  if (family === "iphone" || family === "samsung") return "phone"
  return family === "airpods" || family === "watch" || family === "wallet" ? family : null
}
export function formsOf(caseType: CatalogCaseType): ProductForm[] {
  const forms = (caseType.devices ?? []).map((d) => formOfFamily(d.family)).filter((f): f is ProductForm => !!f)
  return FORMS.filter((f) => forms.includes(f))
}
/** A case type fits a brand when it is made for at least one of its models. */
export function fitsEveryFamily(caseType: CatalogCaseType, families: string[]): boolean {
  return families.every((family) => (caseType.devices ?? []).some((d) => d.family === family))
}

/** The brands a section is probably about, read from its label and old links. */
export function guessFamilies(text: string): DeviceFamilyKey[] {
  const lower = text.toLowerCase()
  const found = DEVICE_FAMILIES.filter((family) => ({
    iphone: /iphone/,
    samsung: /samsung|galaxy/,
    airpods: /airpod|earbud/,
    watch: /watch/,
    wallet: /wallet/,
  })[family].test(lower))
  return found.length ? found : ["iphone", "samsung"]
}

export const sectionKind = (section: Pick<AdminMenuSection, "kind">): MenuKind =>
  KINDS.includes(section.kind as MenuKind) ? section.kind as MenuKind : "links"
export const sectionPlacement = (section: Pick<AdminMenuSection, "placement">): MenuPlacement =>
  PLACEMENTS.includes(section.placement as MenuPlacement) ? section.placement as MenuPlacement : "all"

/** A complete config for `kind`, reading what is saved and filling the defaults. */
export function readConfig(kind: "devices", raw: unknown, guess?: DeviceFamilyKey[]): DevicesConfig
export function readConfig(kind: "case_types", raw: unknown): CaseTypesConfig
export function readConfig(kind: "collections", raw: unknown): CollectionsConfig
export function readConfig(kind: MenuKind, raw: unknown, guess?: DeviceFamilyKey[]): SectionConfig | null
export function readConfig(kind: MenuKind, raw: unknown, guess: DeviceFamilyKey[] = ["iphone", "samsung"]): SectionConfig | null {
  const v = record(raw)
  if (kind === "devices") {
    const families = Array.isArray(v.families) ? [...new Set(v.families.filter(isFamily))] : guess
    return { families, case_type: typeof v.case_type === "string" && v.case_type ? v.case_type : null }
  }
  if (kind === "case_types") {
    const links = Object.fromEntries(Object.entries(record(v.links)).filter((e): e is [string, string] => typeof e[1] === "string"))
    return {
      form: FORMS.includes(v.form as ProductForm) ? v.form as ProductForm : "phone",
      exclude: Array.isArray(v.exclude) ? [...new Set(v.exclude.filter((s): s is string => typeof s === "string" && !!s))] : [],
      links,
    }
  }
  if (kind === "collections") {
    return {
      title: typeof v.title === "string" ? v.title : "Collections",
      view_all_href: typeof v.view_all_href === "string" ? v.view_all_href : "/collections/",
      limit: typeof v.limit === "number" ? v.limit : 8,
    }
  }
  return null
}

/**
 * The section's config as the server takes it, or an Error with the server's
 * message. `caseTypes` (the active case types) is null while the catalogue is
 * still loading; the server still checks the slugs then. `allCaseTypes` (every
 * case type, switched off ones too) decides which Case styles settings belong
 * to another product.
 */
export function configPayload(
  kind: MenuKind,
  config: unknown,
  caseTypes: CatalogCaseType[] | null,
  allCaseTypes: CatalogCaseType[] | null = caseTypes
): SectionConfig | null {
  if (kind === "links") return null
  if (kind === "devices") {
    const c = readConfig("devices", config, [])
    if (!c.families.length) throw new Error(MESSAGES.families)
    if (c.case_type && caseTypes && !caseTypes.some((t) => t.slug === c.case_type)) throw new Error(MESSAGES.caseType)
    return c
  }
  if (kind === "case_types") {
    const c = readConfig("case_types", config)
    // Switching the product drops the settings of case types made only for
    // other products. Every other slug is kept, even though the screen does not
    // list it: a switched-off case type, or one with no models yet, gets its
    // hidden state and link back when it returns.
    const otherForm = allCaseTypes
      ? new Set(allCaseTypes.filter((t) => {
          const forms = formsOf(t)
          return forms.length > 0 && !forms.includes(c.form)
        }).map((t) => t.slug))
      : null
    const links: Record<string, string> = {}
    for (const [slug, raw] of Object.entries(c.links)) {
      const href = raw.trim()
      if (!href || otherForm?.has(slug)) continue
      if (!safeMenuHref(href)) throw new Error(MESSAGES.href)
      links[slug] = href
    }
    return { form: c.form, exclude: c.exclude.filter((slug) => !otherForm?.has(slug)), links }
  }
  if (kind === "collections") {
    const c = readConfig("collections", config)
    const title = c.title.trim() || "Collections"
    if (title.length > TITLE_MAX) throw new Error(MESSAGES.title)
    const view_all_href = c.view_all_href.trim() || "/collections/"
    if (!safeMenuHref(view_all_href)) throw new Error(MESSAGES.href)
    if (!Number.isInteger(c.limit) || c.limit < 1 || c.limit > 12) throw new Error(MESSAGES.limit)
    return { title, view_all_href, limit: c.limit }
  }
  throw new Error(MESSAGES.kind)
}

export type SectionDraft = Pick<AdminMenuSection, "label" | "href" | "image_url" | "badge"> & {
  kind: MenuKind
  placement: MenuPlacement
  config: unknown
}

/** The POST /admin/content/menu-sections/:id body for a typed (header) section. */
export function sectionPayload(
  section: SectionDraft,
  caseTypes: CatalogCaseType[] | null,
  allCaseTypes: CatalogCaseType[] | null = caseTypes
) {
  const label = section.label.trim()
  if (!label) throw new Error(MESSAGES.label)
  if (!KINDS.includes(section.kind)) throw new Error(MESSAGES.kind)
  if (!PLACEMENTS.includes(section.placement)) throw new Error(MESSAGES.placement)
  const badge = (section.badge ?? "").trim()
  if (badge.length > BADGE_MAX) throw new Error(MESSAGES.badge)
  const image = (section.image_url ?? "").trim()
  if (image && !isHttps(image)) throw new Error(MESSAGES.image)
  return {
    label,
    href: (section.href ?? "").trim(),
    kind: section.kind,
    image_url: image || null,
    // "" clears it on the server.
    badge,
    placement: section.placement,
    config: configPayload(section.kind, section.config, caseTypes, allCaseTypes),
  }
}
