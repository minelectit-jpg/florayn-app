import type { DeviceRecord } from "./catalog"
import type { CaseTypeInfo, CollectionCard, MenuKind, MenuPlacement, MenuSection, MenuSectionConfig, ProductForm, SiteContent } from "./content"
import { DEFAULT_PRESENTATION, type DeviceFamilyKey } from "./storefront-presentation"

/**
 * Everything the header, its menu drawer, the desktop panels and the search
 * sheet need, in one compact prop built on the server (app/layout.tsx). It is
 * sent once per page in the RSC payload, so it stays small (<= 10 KB; see
 * tests/header-data.test.cjs): tuples instead of objects, no descriptions, no
 * design lists, and no Men menu when it equals the Women one.
 */

export type NavLink = { label: string; href: string; badge: string | null }
export type NavGroup = { heading: string | null; links: NavLink[] }
export type NavSection = {
  id: string
  label: string
  href: string | null
  kind: MenuKind
  image: string | null
  badge: string | null
  placement: MenuPlacement
  config: MenuSectionConfig | null
  /** Only for kind "links". */
  groups: NavGroup[]
}
/** [slug, name, family, badge] in /store/devices order: each family newest first. */
export type HeaderDevice = [slug: string, name: string, family: string, badge: string | null]
/**
 * [slug, name, fromPrice, image, forms, prices] in case-type order. fromPrice
 * is the lowest over every form; prices[i] is the lowest for forms[i] (a phone
 * section shows Alcantara's phone price, never its cheaper card-wallet one).
 */
export type HeaderCaseType = [slug: string, name: string, fromPrice: number | null, image: string | null, forms: ProductForm[], prices: (number | null)[]]
/**
 * [slug, title, image, contain, aud]: contain 1 = a product render on white
 * (show it contained, not cropped); aud is a mask, 1 = Women, 2 = Men, 3 = both.
 */
export type HeaderCollection = [slug: string, title: string, image: string | null, contain: 0 | 1, aud: 1 | 2 | 3]

export type HeaderData = {
  women: NavSection[]
  /** null when the Men menu is the Women one (then Men uses `women`). */
  men: NavSection[] | null
  devices: HeaderDevice[]
  caseTypes: HeaderCaseType[]
  collections: HeaderCollection[]
  /** Brand names by family (Admin > Navigation). */
  families: Record<DeviceFamilyKey, string>
  drawerLinks: { label: string; href: string }[]
  rememberDevice: boolean
  search: {
    placeholder: string
    suggest: { women: string[]; men: string[] }
    help: { label: string; href: string }
  }
}

/** The audience mask bit for a mode. */
export const AUDIENCE_BIT = { women: 1, men: 2 } as const

function navSection(section: MenuSection): NavSection {
  const kind: MenuKind = section.kind ?? "links"
  return {
    id: section.id,
    label: section.label,
    href: section.href ?? null,
    kind,
    image: section.image ?? null,
    badge: section.badge ?? null,
    placement: section.placement ?? "all",
    config: kind === "links" ? null : section.config ?? null,
    groups: kind === "links"
      ? section.groups.map((g) => ({ heading: g.heading, links: g.links.map((l) => ({ label: l.label, href: l.href, badge: l.badge ?? null })) }))
      : [],
  }
}

/** Two menus are the same when they differ only in ids. */
function sameMenu(a: NavSection[], b: NavSection[]): boolean {
  const strip = (list: NavSection[]) => JSON.stringify(list.map(({ id: _id, ...rest }) => rest))
  return strip(a) === strip(b)
}

function audienceMask(card: CollectionCard): 1 | 2 | 3 {
  if (!card.audiences) return 3
  const women = card.audiences.includes("women")
  const men = card.audiences.includes("men")
  return women && !men ? 1 : men && !women ? 2 : 3
}

/** The most collection cards one mode's menu can show (the Collections section's limit tops out at 12). */
export const MENU_COLLECTIONS_PER_MODE = 12

/**
 * The cards marked Show in menu, in page order, capped per mode rather than
 * overall: a card is kept while Women or Men (whichever it is for) still has
 * room for it. A global cap would starve a mode whose cards come later, and
 * collectionsFor() filters by mode only after this. At most 24 cards, and
 * only when the two modes share none.
 */
function menuCollections(cards: CollectionCard[]): HeaderCollection[] {
  const kept: HeaderCollection[] = []
  let women = 0
  let men = 0
  for (const card of cards) {
    if (card.in_menu === false) continue
    const aud = audienceMask(card)
    const forWomen = (aud & AUDIENCE_BIT.women) !== 0
    const forMen = (aud & AUDIENCE_BIT.men) !== 0
    if (!(forWomen && women < MENU_COLLECTIONS_PER_MODE) && !(forMen && men < MENU_COLLECTIONS_PER_MODE)) continue
    if (forWomen) women++
    if (forMen) men++
    kept.push([card.slug, card.title, card.image ?? card.artwork ?? null, card.image ? 0 : card.artwork ? 1 : 0, aud])
  }
  return kept
}

function headerCaseType(c: CaseTypeInfo): HeaderCaseType {
  const fromPrice = c.fromPrice ?? c.price ?? null
  const forms = c.forms ?? []
  return [c.slug, c.name, fromPrice, c.image ?? null, forms, forms.map((form) => c.fromPrices?.[form] ?? fromPrice)]
}

export function buildHeaderData(content: SiteContent, caseTypes: CaseTypeInfo[], devices: DeviceRecord[]): HeaderData {
  const women = content.primary.map(navSection)
  const menOwn = content.primaryMen?.length ? content.primaryMen.map(navSection) : null
  const navigation = content.navigation ?? DEFAULT_PRESENTATION.navigation
  const search = content.search ?? DEFAULT_PRESENTATION.search
  return {
    women,
    men: menOwn && !sameMenu(women, menOwn) ? menOwn : null,
    devices: devices.map((d) => [d.slug, d.name, d.family, d.badge ?? null]),
    caseTypes: caseTypes.map(headerCaseType),
    collections: menuCollections(content.collections),
    families: { ...DEFAULT_PRESENTATION.navigation.family_labels, ...navigation.family_labels },
    drawerLinks: navigation.drawer_links,
    rememberDevice: navigation.remember_device,
    search: {
      placeholder: search.placeholder,
      suggest: { women: search.suggest_women, men: search.suggest_men },
      help: { label: search.help_label, href: search.help_href },
    },
  }
}

/** The sections of one mode, for one surface ("drawer" = the phone menu, "bar" = the desktop row). */
export function sectionsFor(data: HeaderData, audience: "women" | "men", surface: "drawer" | "bar"): NavSection[] {
  const list = audience === "men" && data.men ? data.men : data.women
  return list.filter((s) => s.placement === "all" || s.placement === surface)
}

/*
 * The wire form of HeaderData: what the layout actually sends in every page's
 * RSC payload. Same content, about 40% smaller: tuples instead of objects,
 * default values left out, the image host written once, and each device's slug
 * only when it is not simply its name in kebab case. The header shell unpacks
 * it once (useMemo), so everything else keeps reading HeaderData.
 */
const KINDS: MenuKind[] = ["links", "devices", "case_types", "collections"]
const PLACEMENTS: MenuPlacement[] = ["all", "drawer", "bar"]
type WireLink = [label: string, href: string, badge?: string]
type WireGroup = [heading: string | 0, links: WireLink[]]
/** [id, label, href|0, kind, image|0, badge|0, placement, config|0, groups], trailing defaults dropped. */
type WireSection = (string | number | MenuSectionConfig | WireGroup[])[]
/** A name when the slug is the kebab-cased name and there is no badge, else [name, slug|0, badge?]. */
type WireDevice = string | [name: string, slug: string | 0, badge?: string]
/** prices only when some form's price differs from fromPrice (Alcantara); otherwise every form costs fromPrice. */
type WireCaseType = [slug: string, name: string, fromPrice: number | null, image: string | 0, forms: ProductForm[], prices?: (number | null)[]]
export type HeaderWire = {
  img: string
  w: WireSection[]
  m: WireSection[] | null
  d: [family: string, devices: WireDevice[]][]
  c: WireCaseType[]
  col: [slug: string, title: string, image: string | 0, contain: 0 | 1, aud: 1 | 2 | 3][]
  f: HeaderData["families"]
  l: HeaderData["drawerLinks"]
  r: boolean
  s: HeaderData["search"]
}

const kebab = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
function trim<T extends unknown[]>(tuple: T): T {
  while (tuple.length && (tuple[tuple.length - 1] === 0 || tuple[tuple.length - 1] == null)) tuple.pop()
  return tuple
}
/** The longest "https://host/" all the images share (the R2 bucket in practice). */
function imageBase(urls: (string | null)[]): string {
  const hosts = urls.map((url) => url?.match(/^https:\/\/[^/]+\//)?.[0]).filter((h): h is string => !!h)
  const counts = new Map<string, number>()
  for (const host of hosts) counts.set(host, (counts.get(host) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
}

export function packHeaderData(data: HeaderData): HeaderWire {
  const sections = [...data.women, ...(data.men ?? [])]
  const img = imageBase([...sections.map((s) => s.image), ...data.caseTypes.map((c) => c[3]), ...data.collections.map((c) => c[2])])
  const rel = (url: string | null): string | 0 => (!url ? 0 : img && url.startsWith(img) ? url.slice(img.length) : url)
  const section = (s: NavSection): WireSection => trim([
    s.id, s.label, s.href ?? 0, KINDS.indexOf(s.kind), rel(s.image), s.badge ?? 0, PLACEMENTS.indexOf(s.placement), s.config ?? 0,
    s.groups.length ? s.groups.map((g): WireGroup => [g.heading ?? 0, g.links.map((l) => trim<WireLink>([l.label, l.href, l.badge ?? undefined]))]) : 0,
  ])
  const d: HeaderWire["d"] = []
  for (const [slug, name, family, badge] of data.devices) {
    if (d[d.length - 1]?.[0] !== family) d.push([family, []])
    d[d.length - 1][1].push(!badge && kebab(name) === slug ? name : trim<[string, string | 0, string?]>([name, kebab(name) === slug ? 0 : slug, badge ?? undefined]))
  }
  return {
    img,
    w: data.women.map(section),
    m: data.men?.map(section) ?? null,
    d,
    c: data.caseTypes.map(([slug, name, fromPrice, image, forms, prices]): WireCaseType =>
      prices.some((p) => p !== fromPrice) ? [slug, name, fromPrice, rel(image), forms, prices] : [slug, name, fromPrice, rel(image), forms]),
    col: data.collections.map(([slug, title, image, contain, aud]) => [slug, title, rel(image), contain, aud]),
    f: data.families,
    l: data.drawerLinks,
    r: data.rememberDevice,
    s: data.search,
  }
}

export function unpackHeaderData(wire: HeaderWire): HeaderData {
  // Only a path packed off the shared host is relative ("site/x.jpg"); a
  // site path ("/brand/x.png") or any other URL was sent as it was.
  const abs = (path: string | 0 | null | undefined): string | null => (!path ? null : /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path) ? path : `${wire.img}${path}`)
  const section = (t: WireSection): NavSection => {
    const [id, label, href, kind, image, badge, placement, config, groups] = t as [string, string, (string | 0)?, number?, (string | 0)?, (string | 0)?, number?, (MenuSectionConfig | 0)?, (WireGroup[] | 0)?]
    return {
      id, label, href: href || null, kind: KINDS[kind ?? 0], image: abs(image), badge: badge || null,
      placement: PLACEMENTS[placement ?? 0], config: config || null,
      groups: (groups || []).map(([heading, links]) => ({ heading: heading || null, links: links.map(([l, h, b]) => ({ label: l, href: h, badge: b ?? null })) })),
    }
  }
  return {
    women: wire.w.map(section),
    men: wire.m?.map(section) ?? null,
    devices: wire.d.flatMap(([family, list]) => list.map((entry): HeaderDevice => {
      if (typeof entry === "string") return [kebab(entry), entry, family, null]
      const [name, slug, badge] = entry
      return [slug || kebab(name), name, family, badge ?? null]
    })),
    caseTypes: wire.c.map(([slug, name, fromPrice, image, forms, prices]) => [slug, name, fromPrice, abs(image), forms, prices ?? forms.map(() => fromPrice)]),
    collections: wire.col.map(([slug, title, image, contain, aud]) => [slug, title, abs(image), contain, aud]),
    families: wire.f,
    drawerLinks: wire.l,
    rememberDevice: wire.r,
    search: wire.s,
  }
}
