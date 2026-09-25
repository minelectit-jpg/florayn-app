import { withAudience, type Audience } from "@/lib/audience"
import { formOfFamily, type CaseTypesSectionConfig, type CollectionsSectionConfig, type DevicesSectionConfig, type ProductForm } from "@/lib/content"
import { AUDIENCE_BIT, type HeaderCaseType, type HeaderCollection, type HeaderData, type HeaderDevice, type NavSection } from "@/lib/header-data"

/**
 * What the menu does with each admin section, shared by the phone drawer
 * (nav-drawer.tsx) and the desktop panels. Pure functions of the header prop,
 * so the rules below are tested without a browser (tests/nav-model.test.cjs).
 *
 * Hrefs that take an audience come back ready for that mode ("/men/shop/…");
 * resolveSection's "link" href is the plain (Women) path.
 */

export type ResolvedSection =
  | { type: "models"; family: string }
  | { type: "brands"; families: string[] }
  | { type: "link"; href: string }
  | { type: "styles" }
  | { type: "links" }
  | { type: "collections" }
  | { type: "none" }

export type FamilySummary = { family: string; label: string; count: number; badge: string | null }
export type SeriesGroup = { heading: string | null; devices: HeaderDevice[] }

export function devicesConfig(section: NavSection | null | undefined): DevicesSectionConfig | null {
  const config = section?.kind === "devices" ? section.config : null
  return config && "families" in config && Array.isArray(config.families) ? config : null
}

export function caseTypesConfig(section: NavSection | null | undefined): CaseTypesSectionConfig | null {
  const config = section?.kind === "case_types" ? section.config : null
  return config && "form" in config ? config : null
}

/** The collections row's settings; an older or empty config gets the defaults. */
export function collectionsConfig(section: NavSection): CollectionsSectionConfig {
  const config = section.kind === "collections" ? section.config : null
  const own = config && "view_all_href" in config ? config : null
  return {
    title: own?.title || section.label || "Collections",
    view_all_href: own?.view_all_href || section.href || "/collections/",
    limit: own?.limit && own.limit > 0 ? own.limit : 8,
  }
}

/** A family's devices in the order given: newest first (from /store/devices). */
export function modelsOf(data: HeaderData, family: string): HeaderDevice[] {
  return data.devices.filter((device) => device[2] === family)
}

/** The section's brands that have devices, in the section's order, with a count and the first owner-set badge. */
export function familiesOf(section: NavSection, data: HeaderData): FamilySummary[] {
  const labels = data.families as Record<string, string>
  return (devicesConfig(section)?.families ?? [])
    .map((family) => {
      const devices = modelsOf(data, family)
      return { family, label: labels[family] || family, count: devices.length, badge: devices.find((d) => d[3])?.[3] ?? null }
    })
    .filter((summary) => summary.count > 0)
}

/** The product form a case_types section is for (phone when unset). */
export function sectionForm(section: NavSection): ProductForm {
  return caseTypesConfig(section)?.form ?? "phone"
}

/** The case types a case_types section lists: those sold for its form, minus its exclusions, in case-type order. */
export function stylesOf(section: NavSection, data: HeaderData): HeaderCaseType[] {
  const form = sectionForm(section)
  const exclude = new Set(caseTypesConfig(section)?.exclude ?? [])
  return data.caseTypes.filter((caseType) => caseType[4].includes(form) && !exclude.has(caseType[0]))
}

/**
 * A style's "from" price in a section of this form: the lowest price of that
 * form (Alcantara phone cases from ৳3,800, even though its card wallet is
 * ৳1,900), else the overall lowest.
 */
export function styleFromPrice(caseType: HeaderCaseType, form: ProductForm): number | null {
  const i = caseType[4].indexOf(form)
  return (i >= 0 ? caseType[5]?.[i] : null) ?? caseType[2]
}

function linkOr(section: NavSection): ResolvedSection {
  return section.href ? { type: "link", href: section.href } : { type: "none" }
}

/**
 * What tapping a section opens. A devices section with two or more brands
 * opens the brand list; with one brand, that brand's models (Earbuds goes
 * straight to AirPods); with one device, that device's shop. Anything with
 * nothing to list falls back to its own link, or is left out.
 */
export function resolveSection(section: NavSection, data: HeaderData): ResolvedSection {
  switch (section.kind) {
    case "collections":
      return { type: "collections" }
    case "devices": {
      const families = familiesOf(section, data)
      if (families.length >= 2) return { type: "brands", families: families.map((f) => f.family) }
      if (families.length === 1) {
        const models = modelsOf(data, families[0].family)
        return models.length === 1
          ? { type: "link", href: shopHref(models[0], section, data, "women") }
          : { type: "models", family: families[0].family }
      }
      return linkOr(section)
    }
    case "case_types":
      return stylesOf(section, data).length ? { type: "styles" } : linkOr(section)
    default:
      return section.groups.some((group) => group.links.length) ? { type: "links" } : linkOr(section)
  }
}

/**
 * "iPhone 17 Pro Max" -> "iPhone 17", "Samsung S26 Ultra" -> "Samsung S26",
 * "iPhone 16e" -> "iPhone 16": the name up to its first model number. null
 * when the name has no number ("AirPods Max").
 */
function seriesBase(name: string): string | null {
  const match = name.match(/^(.*?)(\p{L}*\d+)/u)
  return match ? `${match[1]}${match[2]}`.trim() : null
}

/**
 * The models list under series subheads ("iPhone 17 series"), but only when
 * every name has a number and at least two series have two or more models,
 * so a short or mixed list (AirPods) stays flat. Groups keep the given order.
 */
export function seriesGroups(devices: HeaderDevice[]): SeriesGroup[] {
  if (!devices.length) return []
  const flat = [{ heading: null, devices }]
  const bases = devices.map((device) => seriesBase(device[1]))
  if (bases.some((base) => !base)) return flat
  const groups = new Map<string, SeriesGroup>()
  devices.forEach((device, i) => {
    const base = bases[i]!
    const key = base.toLowerCase()
    const group = groups.get(key) ?? { heading: `${base} series`, devices: [] }
    group.devices.push(device)
    groups.set(key, group)
  })
  const full = [...groups.values()].filter((group) => group.devices.length >= 2).length
  return full >= 2 ? [...groups.values()] : flat
}

/**
 * A model's shop, in the section's case type when that case type is made for
 * the device's form (so Signature Earbuds never opens on an iPhone), else the
 * device's own shop.
 */
export function shopHref(device: HeaderDevice, section: NavSection | null, data: HeaderData, audience: Audience): string {
  const [slug, , family] = device
  const caseType = devicesConfig(section)?.case_type ?? null
  const form = formOfFamily(family)
  const fits = !!caseType && !!form && data.caseTypes.some((c) => c[0] === caseType && c[4].includes(form))
  return withAudience(fits ? `/shop/${slug}/${caseType}/` : `/shop/${slug}/`, audience)
}

/**
 * A style row's link: the section's override for that case type, else the
 * case type on the shopper's own phone when it is the section's form, else on
 * the first (newest) device of that form.
 */
export function caseStyleHref(caseType: HeaderCaseType, section: NavSection, data: HeaderData, audience: Audience, rememberedSlug: string | null): string {
  const config = caseTypesConfig(section)
  const override = config?.links?.[caseType[0]]
  if (override) return withAudience(override, audience)
  const form = sectionForm(section)
  const remembered = rememberedSlug ? data.devices.find((d) => d[0] === rememberedSlug) : undefined
  const device = remembered && formOfFamily(remembered[2]) === form
    ? remembered
    : data.devices.find((d) => formOfFamily(d[2]) === form)
  return withAudience(device ? `/shop/${device[0]}/${caseType[0]}/` : section.href || "/shop/", audience)
}

/** The collection cards for a mode (by their audience mask), at most `limit`. */
export function collectionsFor(data: HeaderData, audience: Audience, limit: number): HeaderCollection[] {
  const bit = AUDIENCE_BIT[audience]
  return data.collections.filter((card) => (card[4] & bit) !== 0).slice(0, Math.max(0, limit))
}

/**
 * Two things worth typing, taken from the list itself, for the no-match hint:
 * the newest model and the newest of another series, shortened the way people
 * type them ("17 Pro Max", "S26 Ultra"). A bare number stays a full name.
 */
export function exampleQueries(devices: HeaderDevice[]): string[] {
  const short = (name: string) => {
    const rest = name.split(/\s+/).slice(1)
    const numbered = rest[0] && /\d/.test(rest[0])
    return numbered && (rest.length > 1 || /\p{L}/u.test(rest[0])) ? rest.join(" ") : name
  }
  const first = devices[0]
  if (!first) return []
  const firstBase = seriesBase(first[1])
  const other = devices.find((d) => d[2] !== first[2]) ?? devices.find((d) => seriesBase(d[1]) !== firstBase)
  return [...new Set([first, other].filter((d): d is HeaderDevice => !!d).map((d) => short(d[1])))]
}

/** "27 models", "1 model". */
export function modelCount(count: number): string {
  return `${count} model${count === 1 ? "" : "s"}`
}
