import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  DEFAULT_COLLECTIONS_CONFIG,
  safeMenuHref,
  sanitizeBadge,
  sanitizeImageUrl,
  sanitizeMenuConfig,
  type MenuKind,
  type MenuSectionConfig,
} from "../lib/menu-section-input"
import { revalidateStorefront } from "../lib/revalidate-storefront"
import { CATALOG_MODULE } from "../modules/catalog"
import { CONTENT_MODULE } from "../modules/content"
import { MEN_MENU } from "../modules/content/config"
import { DEFAULT_CASE_TYPE_IMAGES } from "../modules/content/defaults"

/**
 * The six "Shop by style" photos the old mega menu hotlinked from florayn.com,
 * copied to R2 (shared with initial-data-seed). A case type only gets one when
 * it has no picture yet.
 */
export const STYLE_IMAGES: Record<string, string> = DEFAULT_CASE_TYPE_IMAGES

/** The storefront caches built from what this script writes: menus, devices and case types. */
export const REFRESH_TAGS = ["content", "catalog", "products"]

/** The header menus and the home page (mode) whose shortcuts they borrow. */
const HEADER_MENUS: [menu: string, audience: "women" | "men"][] = [["primary", "women"], [MEN_MENU, "men"]]

const PHONE = /^phone cases?$/
const EARBUDS = /^ear ?buds? cases?$/
const STYLES = /^styles$/
const OLD_EARBUDS_HREF = "/shop/airpods-pro-3/signature/"
const NEW_EARBUDS_HREF = "/shop/airpods-pro-3/signature-earbuds/"

type Row = Record<string, any>
export type HeaderNavigationInput = {
  menuSections: Row[]
  menuItems: Row[]
  homeSections: Row[]
  devices: Row[]
  caseTypes: Row[]
}
export type HeaderNavigationPlan = {
  /** { id, ...changed fields } for updateMenuSections. */
  sectionUpdates: Row[]
  sectionCreates: Row[]
  deviceBadges: { id: string; badge: string }[]
  caseTypeImages: { id: string; image_url: string }[]
}

const norm = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
const kindOf = (section: Row): MenuKind => section.kind ?? "links"
const https = (value: unknown) => {
  try {
    return sanitizeImageUrl(value)
  } catch {
    return null
  }
}

const COLLECTION_PAGE = /^\/collection\/[a-z0-9-]+\/?$/

/**
 * The seed's old "Collections" column: a Links section with no link of its
 * own, listing only collection pages. Anything else labelled Collections was
 * made (or reworked) by the owner and is not touched.
 */
function isSeededCollectionsColumn(section: Row, items: Row[]): boolean {
  if (norm(section.label) !== "collections" || kindOf(section) !== "links" || section.href) return false
  const own = items.filter((i) => i.section_id === section.id)
  return own.length > 0 && own.every((i) => typeof i.href === "string" && COLLECTION_PAGE.test(i.href.trim()))
}

/** The mode's home shortcuts (category_pills items), first visible section first. */
function pillsFor(homeSections: Row[], audience: "women" | "men"): Row[] {
  const own = homeSections
    .filter((s) => s.type === "category_pills" && (s.audience === "men" ? "men" : "women") === audience)
    .sort((a, b) => Number(!a.is_visible) - Number(!b.is_visible) || (a.position ?? 0) - (b.position ?? 0))
  const items = own[0]?.config?.items
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : []
}

/**
 * What the header v2 upgrade changes, as data (no writes), so it can be tested
 * and a second run can prove it has nothing left to do. Per header menu
 * (Women and Men; an empty Men menu is left alone, it borrows the Women one):
 *
 *   - Phone Case (links) becomes Device models: iPhone and Samsung, opening on
 *     Signature; its picture is the mode's home "Phone Case" shortcut picture.
 *   - Earbuds Cases becomes Device models: AirPods, opening on Signature
 *     Earbuds; the old /shop/airpods-pro-3/signature/ link is corrected.
 *   - Styles becomes Case styles for phones. A link that went somewhere other
 *     than the style's own shop (Alcantara and Essentials go to their
 *     collection pages) is kept as that style's link; a hidden one is left out.
 *   - A Collections row (phone menu only, shown) goes at the top: the seed's
 *     old hand-made Collections column becomes it, even if it was hidden, so
 *     Collections never shows twice; otherwise a new row is added. A section
 *     the owner made (any other shape) is left as it is.
 *   - Each home shortcut with a page (not Coming Soon), other than phone and
 *     earbuds cases, becomes a phone-menu-only link section with its picture.
 *
 * Devices get the badge their old menu link had (New), and case types with no
 * picture get the R2 copy of their "Shop by style" photo. Only empty or
 * default values are filled; the old links stay in the database, so setting a
 * section's Type back to Links restores it.
 */
export function planHeaderNavigation(input: HeaderNavigationInput): HeaderNavigationPlan {
  const plan: HeaderNavigationPlan = { sectionUpdates: [], sectionCreates: [], deviceBadges: [], caseTypeImages: [] }
  const active = input.caseTypes.filter((c) => c.is_active !== false)
  const activeSlugs = active.map((c) => c.slug as string)
  const caseType = (slug: string) => (activeSlugs.includes(slug) ? slug : null)
  const config = (kind: MenuKind, raw: unknown): MenuSectionConfig | null => {
    try {
      return sanitizeMenuConfig(kind, raw, activeSlugs)
    } catch {
      return null
    }
  }

  for (const [menu, audience] of HEADER_MENUS) {
    const sections = input.menuSections.filter((s) => s.menu === menu)
    if (!sections.length) continue
    const pills = pillsFor(input.homeSections, audience)
    const pillImage = (pattern: RegExp) => https(pills.find((p) => pattern.test(norm(p.label)))?.image)

    const phone = sections.find((s) => PHONE.test(norm(s.label)))
    const earbuds = sections.find((s) => EARBUDS.test(norm(s.label)))
    const styles = sections.find((s) => STYLES.test(norm(s.label)))

    for (const [section, families, slug, pattern] of [
      [phone, ["iphone", "samsung"], "signature", PHONE],
      [earbuds, ["airpods"], "signature-earbuds", EARBUDS],
    ] as const) {
      if (!section) continue
      const patch: Row = {}
      if (kindOf(section) === "links") {
        const next = config("devices", { families, case_type: caseType(slug) })
        if (next) Object.assign(patch, { kind: "devices", config: next })
      }
      const image = section.image_url ? null : pillImage(pattern)
      if (image) patch.image_url = image
      if (section === earbuds && section.href === OLD_EARBUDS_HREF) patch.href = NEW_EARBUDS_HREF
      if (Object.keys(patch).length) plan.sectionUpdates.push({ id: section.id, ...patch })
    }

    if (styles && kindOf(styles) === "links") {
      const exclude: string[] = []
      const links: Record<string, string> = {}
      for (const item of input.menuItems.filter((i) => i.section_id === styles.id)) {
        const type = active.find((c) => norm(c.name) === norm(item.label))
        if (!type) continue
        if (item.is_visible === false) {
          if (!exclude.includes(type.slug)) exclude.push(type.slug)
          continue
        }
        const own = new RegExp(`^/shop/[a-z0-9-]+/${type.slug}/?$`)
        if (typeof item.href === "string" && !own.test(item.href) && safeMenuHref(item.href)) links[type.slug] = item.href
      }
      const next = config("case_types", { form: "phone", exclude, links })
      if (next) plan.sectionUpdates.push({ id: styles.id, kind: "case_types", config: next })
    }

    const positions = sections.map((s) => Number(s.position) || 0)
    const labels = new Set(sections.map((s) => norm(s.label)))
    if (!sections.some((s) => kindOf(s) === "collections")) {
      // The spec's row: automatic, phone menu only, shown, first.
      const row = {
        kind: "collections", placement: "drawer", position: Math.min(...positions) - 1, is_visible: true,
        config: { ...DEFAULT_COLLECTIONS_CONFIG },
      }
      // Every database seeded since 2026-09-02 has the seed's hand-made
      // Collections column (shown or hidden, copied into the Men menu too); it
      // becomes that row rather than Collections showing twice.
      const seeded = sections.find((s) => isSeededCollectionsColumn(s, input.menuItems))
      if (seeded) {
        plan.sectionUpdates.push({ id: seeded.id, ...row })
      } else {
        plan.sectionCreates.push({ menu, label: "Collections", href: null, image_url: null, badge: null, ...row })
        labels.add("collections")
      }
    }

    let position = Math.max(...positions)
    for (const pill of pills) {
      const label = String(pill.label ?? "").trim()
      const href = typeof pill.href === "string" ? pill.href.trim() : ""
      if (!label || !href || pill.note || PHONE.test(norm(label)) || EARBUDS.test(norm(label))) continue
      if (labels.has(norm(label)) || !safeMenuHref(href)) continue
      labels.add(norm(label))
      plan.sectionCreates.push({
        menu, label, href, kind: "links", image_url: https(pill.image), badge: null,
        placement: "drawer", position: ++position, is_visible: true, config: null,
      })
    }
  }

  // Device badges from the old model links (/shop/<device>/...), first one wins.
  const headerSections = new Set(input.menuSections.filter((s) => HEADER_MENUS.some(([menu]) => menu === s.menu)).map((s) => s.id))
  const badged = new Set<string>()
  for (const item of input.menuItems) {
    if (!headerSections.has(item.section_id) || item.is_visible === false) continue
    let badge: string | null
    try {
      badge = sanitizeBadge(item.badge)
    } catch {
      continue
    }
    const slug = typeof item.href === "string" ? item.href.match(/^\/shop\/([a-z0-9-]+)\//)?.[1] : undefined
    const device = slug ? input.devices.find((d) => d.slug === slug) : undefined
    if (!badge || !device || device.badge || badged.has(device.id)) continue
    badged.add(device.id)
    plan.deviceBadges.push({ id: device.id, badge })
  }

  for (const type of input.caseTypes) {
    if (!type.image_url && STYLE_IMAGES[type.slug]) plan.caseTypeImages.push({ id: type.id, image_url: STYLE_IMAGES[type.slug] })
  }
  return plan
}

/** One-off, inside db:migrate after the schema migrations: see planHeaderNavigation. */
export default async function headerNavigation({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const content: any = container.resolve(CONTENT_MODULE)
  const catalog: any = container.resolve(CATALOG_MODULE)

  // Plain reads: a fresh database has no menu yet (the storefront's first read
  // seeds it), so there is nothing to upgrade and nothing is seeded from here.
  const [homeSections, menuSections, menuItems, devices, caseTypes] = await Promise.all([
    content.listHomeSections({}, { take: 1000 }),
    content.listMenuSections({}, { take: 1000 }),
    content.listMenuItems({}, { take: 5000 }),
    catalog.listDevices({}, { select: ["id", "slug", "badge"], take: 1000 }),
    catalog.listCaseTypes({}, { select: ["id", "slug", "name", "image_url", "is_active"], take: 500 }),
  ])
  const plan = planHeaderNavigation({ menuSections, menuItems, homeSections, devices, caseTypes })

  for (const update of plan.sectionUpdates) await content.updateMenuSections(update)
  if (plan.sectionCreates.length) await content.createMenuSections(plan.sectionCreates)
  if (plan.deviceBadges.length) await catalog.updateDevices(plan.deviceBadges)
  if (plan.caseTypeImages.length) await catalog.updateCaseTypes(plan.caseTypeImages)

  logger.info(
    `[header-navigation] ${plan.sectionUpdates.length} menu sections updated, ${plan.sectionCreates.length} added, ` +
    `${plan.deviceBadges.length} device badges, ${plan.caseTypeImages.length} case-type pictures`
  )

  // These writes skip the admin routes, so nothing has told the storefront:
  // refresh the header, search index and pages it built from the old rows, as
  // the admin's writes do. The data is saved either way, so a storefront that
  // cannot be reached (or is not configured here) is logged, never a failure.
  const changed = plan.sectionUpdates.length + plan.sectionCreates.length + plan.deviceBadges.length + plan.caseTypeImages.length
  if (!changed) return
  let refreshed = false
  try {
    refreshed = await revalidateStorefront({ tags: REFRESH_TAGS })
  } catch {
    refreshed = false
  }
  if (refreshed) logger.info(`[header-navigation] storefront refreshed (${REFRESH_TAGS.join(", ")})`)
  else logger.warn("[header-navigation] storefront not refreshed: use Admin > Publish > Refresh storefront now before purging the CDN")
}
