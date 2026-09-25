import { readAudienceTag } from "./audience"
import type { SearchPresentation } from "./storefront-presentation"

/**
 * The search index (v2) that GET /store/search-index serves and the
 * storefront's /search-index.json edge-caches. The browser fetches it once, on
 * the first sign of wanting to search, and searches it locally.
 *
 * buildSearchIndex is PURE over rows the route has already read, so it is
 * tested without a database (tests/search-index.test.cjs, which also holds the
 * size budget: 400 designs <= 60 KB of JSON, <= 14 KB gzipped).
 *
 * The shape is exactly apps/storefront/src/lib/search/types.ts: tuples to stay
 * small; aud is a mask everywhere (1 = Women, 2 = Men, 3 = both); image paths
 * are relative to `img` when they live there, other hosts stay absolute, and ''
 * means no image. Bump `v` there, here and in the storefront cache key whenever
 * the shape changes.
 *
 * What a design sells, for which model, at what price and with which picture
 * comes from its precomputed card (metadata.card.pairs, the variants), never
 * from a naming rule: a case type's own devices and prices are the baseline,
 * and each product only carries where it differs.
 */

export type Aud = 1 | 2 | 3
export type IndexForm = "phone" | "airpods" | "watch" | "wallet" | "product"
/** [price, dv indexes]: the devices that cost this instead of the flat price. */
export type IndexPriceGroup = [price: number, devices: number[]]
export type IndexCaseType = [
  slug: string,
  name: string,
  fromPrice: number | null,
  forms: IndexForm[],
  sold: number[],
  price: number | null,
  groups: IndexPriceGroup[],
  folder: string,
]
export type IndexDevice = [slug: string, name: string, family: string, badge: string | null]
export type IndexCollection = [slug: string, title: string, image: string, aud: Aud]
/** [ct index, dv indexes it does not sell there, then its own prices when they are not the case type's]. */
export type IndexCaseTypeFacts =
  | [ct: number, notSold: number[]]
  | [ct: number, notSold: number[], price: number | null, groups: IndexPriceGroup[]]
export type IndexProduct = [
  handle: string,
  name: string,
  designSlug: string,
  form: IndexForm,
  aud: Aud,
  caseTypes: number[],
  collection: number,
  thumb: string | [ct: number, device: number],
  fromPrice: number | null,
  notSold: number[],
  pics: 0 | 1 | string,
  facts: IndexCaseTypeFacts[],
]
export type IndexCategory = [label: string, href: string, image: string, aud: Aud]
export type SearchIndex = {
  v: 2
  img: string
  ct: IndexCaseType[]
  dv: IndexDevice[]
  col: IndexCollection[]
  p: IndexProduct[]
  cat: IndexCategory[]
  syn: [words: string[], means: string][]
  sug: { w: string[]; m: string[] }
  help: [label: string, href: string]
  ph: string
}

type Meta = Record<string, any>
export type PriceGroupRow = { price?: unknown; devices?: unknown }
export type IndexProductRow = {
  handle: string
  title?: string | null
  thumbnail?: string | null
  collection_id?: string | null
  metadata?: Meta | null
}
export type IndexDeviceRow = { slug: string; name: string; family: string; badge?: string | null }
export type IndexCaseTypeRow = {
  slug: string
  name: string
  price?: number | null
  /** Saved per-device prices, or the seed's when none are saved (how variants are priced). */
  price_groups?: PriceGroupRow[] | null
  devices?: { slug: string; family: string; is_active?: boolean | null }[] | null
}
/** A getCollectionCards() card (modules/content/config.ts). */
export type IndexCollectionCard = {
  slug: string
  collection_id?: string | null
  title: string
  image?: string | null
  artwork?: string | null
  audiences?: string[]
}
export type IndexMenuSectionRow = {
  label: string
  href?: string | null
  /** Missing on rows older than typed sections, which means "links". */
  kind?: string | null
  /** The section's round picture (https). */
  image_url?: string | null
  position?: number | null
  is_visible?: boolean | null
}

export type SearchIndexInput = {
  /** The public image base, without a trailing slash. */
  img: string
  /** Published products, newest first. */
  products: IndexProductRow[]
  /** Active devices, each family newest first (lib/device-order.ts). */
  devices: IndexDeviceRow[]
  /** Active case types in their admin order, with their devices. */
  caseTypes: IndexCaseTypeRow[]
  /** Visible collection pages as cards, in their order. */
  collections: IndexCollectionCard[]
  /** Rows of the Women ("primary") and Men ("primary-men") header menus. */
  menus: { women: IndexMenuSectionRow[]; men: IndexMenuSectionRow[] }
  search: SearchPresentation
  /** More name -> slug pairs for card.caseTypes (the seed's), beyond the active case types. */
  caseTypeNames?: { slug: string; name: string }[]
  /** A legacy design's case types from the DESIGNS manifest, as /store/shop-catalog merges them. */
  designCaseTypes?: Map<string, string[]>
}

const FORMS = ["phone", "airpods", "watch", "wallet"] as const
type DeviceForm = typeof FORMS[number]
const AUD: Record<string, Aud> = { women: 1, men: 2, both: 3 }

/** iPhone and Samsung are one product form, "phone"; the others are their own. */
export function formOfFamily(family: unknown): DeviceForm | null {
  if (family === "iphone" || family === "samsung") return "phone"
  return family === "airpods" || family === "watch" || family === "wallet" ? family : null
}

/**
 * An image URL for the index: relative to `img` when it lives there, other
 * hosts kept absolute, and '' for none (or an inline data: placeholder, which
 * would blow the size budget and is not a real render anyway).
 */
export function indexImagePath(url: unknown, img: string): string {
  if (typeof url !== "string") return ""
  const value = url.trim()
  if (!/^https?:\/\//i.test(value)) return ""
  return value.startsWith(`${img}/`) ? value.slice(img.length + 1) : value
}

/** The form a product is in: metadata.form, else "phone" for a design, else "product". */
export function productForm(meta: Meta): IndexForm {
  const form = meta.form
  if (typeof form === "string") return (FORMS as readonly string[]).includes(form) ? form as DeviceForm : "product"
  return typeof meta.design_slug === "string" && meta.design_slug.trim() ? "phone" : "product"
}

/**
 * A product's case-type slugs, merged the way /store/shop-catalog merges them:
 * the legacy manifest's, the saved case_type_slugs (known slugs only) and the
 * precomputed card's case-type names mapped to slugs. First-seen order.
 */
export function productCaseTypeSlugs(
  meta: Meta,
  slugByName: Map<string, string>,
  validSlugs: Set<string>,
  manifest: string[] = [],
): string[] {
  const saved = Array.isArray(meta.case_type_slugs) ? meta.case_type_slugs : []
  const cardNames = Array.isArray(meta.card?.caseTypes) ? meta.card.caseTypes : []
  return [...new Set<string>([
    ...manifest,
    ...saved.filter((value: unknown): value is string => typeof value === "string" && validSlugs.has(value)),
    ...cardNames.flatMap((name: unknown) => typeof name === "string" && slugByName.has(name) ? [slugByName.get(name)!] : []),
  ])]
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function minOrNull(values: number[]): number | null {
  return values.length ? Math.min(...values) : null
}

/** The case type's lowest price: its flat price or a cheaper per-device price group. */
function caseTypeFromPrice(caseType: IndexCaseTypeRow): number | null {
  const groups = Array.isArray(caseType.price_groups) ? caseType.price_groups : []
  return minOrNull([caseType.price, ...groups.map((g) => g?.price)].filter(positive))
}

/**
 * Its lowest price for one form: each of its active devices of that form at
 * that device's group price, or the flat price. Falls back to the overall from
 * price when it has no device of the form.
 */
function caseTypeFormPrice(caseType: IndexCaseTypeRow, form: IndexForm, overall: number | null): number | null {
  const groups = Array.isArray(caseType.price_groups) ? caseType.price_groups : []
  const prices = (caseType.devices ?? [])
    .filter((d) => d.is_active !== false && formOfFamily(d.family) === form)
    .map((d) => {
      const group = groups.find((g) => Array.isArray(g?.devices) && g.devices.includes(d.slug))
      return positive(group?.price) ? group!.price as number : caseType.price
    })
    .filter(positive)
  return minOrNull(prices) ?? overall
}

/** Ascending, without repeats. */
function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

/**
 * A case type's per-device prices as dv-index groups, the way variants are
 * priced (caseTypeFormPrice, reprice-case-type): a device's first group wins,
 * a group without a positive price leaves it on the flat price, and a group at
 * the flat price is left out (it changes nothing).
 */
function priceGroups(caseType: IndexCaseTypeRow, dvIndex: Map<string, number>): IndexPriceGroup[] {
  const seen = new Set<number>()
  const out: IndexPriceGroup[] = []
  for (const group of Array.isArray(caseType.price_groups) ? caseType.price_groups : []) {
    if (!Array.isArray(group?.devices)) continue
    const devices: number[] = []
    for (const slug of group.devices) {
      const i = typeof slug === "string" ? dvIndex.get(slug) : undefined
      if (i === undefined || seen.has(i)) continue
      seen.add(i)
      devices.push(i)
    }
    const price = group.price
    if (devices.length && positive(price) && price !== caseType.price) out.push([price, devices.sort((a, b) => a - b)])
  }
  return out
}

/** The price of a device under a flat price and its groups. */
function groupPrice(price: number | null, groups: IndexPriceGroup[], device: number): number | null {
  return groups.find((g) => g[1].includes(device))?.[0] ?? price
}

/** One product's prices for a case type in the same form: the commonest as the flat price, the others as groups. */
function ownPrices(prices: Map<number, number>): [price: number, groups: IndexPriceGroup[]] {
  const byPrice = new Map<number, number[]>()
  for (const [device, price] of prices) byPrice.set(price, [...(byPrice.get(price) ?? []), device])
  const ranked = [...byPrice].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
  return [
    ranked[0][0],
    ranked.slice(1).sort((a, b) => a[0] - b[0]).map(([price, devices]) => [price, devices.sort((a, b) => a - b)]),
  ]
}

/** An image under `img` as [folder, case-type folder, device slug] when it is <folder>/<ct>/<device>/1.webp, else null. */
function renderParts(url: unknown, img: string): [string, string, string] | null {
  const path = indexImagePath(url, img)
  if (!path || /^https?:/i.test(path)) return null
  const parts = path.split("/")
  const n = parts.length
  return n >= 4 && parts[n - 1] === "1.webp" && parts.every(Boolean) ? [parts.slice(0, n - 3).join("/"), parts[n - 3], parts[n - 2]] : null
}

function audienceMask(audiences: string[] | undefined): Aud {
  if (!Array.isArray(audiences)) return 3
  const women = audiences.includes("women")
  const men = audiences.includes("men")
  return women && !men ? 1 : men && !women ? 2 : 3
}

/** An admin link without a /men prefix: the storefront adds it back per mode. */
function plainHref(href: string): string {
  if (href === "/men") return "/"
  if (!/^\/men[/?#]/.test(href)) return href
  const rest = href.slice("/men".length)
  return rest.startsWith("/") ? rest : `/${rest}`
}

function visibleSections(rows: IndexMenuSectionRow[]): IndexMenuSectionRow[] {
  return rows
    .filter((row) => row.is_visible !== false)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
}

/**
 * The header's link sections with an href (StickPad, Phone Charm...), one per
 * href. A link in both menus is for both modes. While the Men menu has no
 * visible sections the Men site shows the Women one (as /store/content does),
 * so every Women link then counts for both.
 */
function categories(menus: SearchIndexInput["menus"], img: string): IndexCategory[] {
  const women = visibleSections(menus.women)
  const menOwn = visibleSections(menus.men)
  const byHref = new Map<string, IndexCategory>()
  const add = (rows: IndexMenuSectionRow[], bit: 1 | 2) => {
    for (const row of rows) {
      if ((row.kind ?? "links") !== "links") continue
      const href = typeof row.href === "string" ? plainHref(row.href.trim()) : ""
      const label = typeof row.label === "string" ? row.label.trim() : ""
      if (!href || !label) continue
      const existing = byHref.get(href)
      if (existing) existing[3] = (existing[3] | bit) as Aud
      else byHref.set(href, [label, href, indexImagePath(row.image_url, img), bit])
    }
  }
  add(women, 1)
  add(menOwn.length ? menOwn : women, 2)
  return [...byHref.values()]
}

export function buildSearchIndex(input: SearchIndexInput): SearchIndex {
  const img = input.img.replace(/\/+$/, "")

  const dv: IndexDevice[] = input.devices.map((d) => [
    d.slug,
    d.name,
    d.family,
    typeof d.badge === "string" && d.badge.trim() ? d.badge.trim() : null,
  ])
  const dvBySlug = new Map<string, number>()
  const dvByName = new Map<string, number>()
  input.devices.forEach((d, i) => {
    if (!dvBySlug.has(d.slug)) dvBySlug.set(d.slug, i)
    if (!dvByName.has(d.name)) dvByName.set(d.name, i)
  })
  const dvForm = input.devices.map((d) => formOfFamily(d.family))

  const ctFrom = input.caseTypes.map(caseTypeFromPrice)
  const ctForms = input.caseTypes.map((c) => {
    const forms = new Set((c.devices ?? []).filter((d) => d.is_active !== false).map((d) => formOfFamily(d.family)))
    return FORMS.filter((form) => forms.has(form))
  })
  // What each case type is made for (its active devices) and what it costs
  // per device: the baseline every product's own facts are measured against.
  const ctSold = input.caseTypes.map((c) => sortedUnique((c.devices ?? [])
    .filter((d) => d.is_active !== false)
    .flatMap((d) => dvBySlug.has(d.slug) ? [dvBySlug.get(d.slug)!] : [])))
  const ctSoldSet = ctSold.map((sold) => new Set(sold))
  const ctPrice = input.caseTypes.map((c) => (positive(c.price) ? c.price : null))
  const ctGroups = input.caseTypes.map((c) => priceGroups(c, dvBySlug))
  const ctIndex = new Map(input.caseTypes.map((c, i) => [c.slug, i]))
  const slugByName = new Map<string, string>([
    ...(input.caseTypeNames ?? []).map((c) => [c.name, c.slug] as [string, string]),
    ...input.caseTypes.map((c) => [c.name, c.slug] as [string, string]),
  ])
  const validSlugs = new Set([...slugByName.values()])

  // Each product's sold pairs, read once from its card ("<device>|<case type>"
  // names, as the variants have them): only this form's devices and active
  // case types count.
  type Pair = { k: number; d: number; price: number | null; image: unknown }
  const rows = input.products.map((product) => {
    const meta = (product.metadata ?? {}) as Meta
    const form = productForm(meta)
    const card = meta.card && typeof meta.card === "object" ? meta.card as Meta : null
    const pairs: Pair[] = []
    if (form !== "product" && card?.pairs && typeof card.pairs === "object") {
      for (const [key, value] of Object.entries(card.pairs as Record<string, Meta | null>)) {
        const bar = key.indexOf("|")
        if (bar < 0) continue
        const d = dvByName.get(key.slice(0, bar))
        const slug = slugByName.get(key.slice(bar + 1))
        const k = slug === undefined ? undefined : ctIndex.get(slug)
        if (d === undefined || k === undefined || dvForm[d] !== form) continue
        pairs.push({ k, d, price: positive(value?.price) ? value!.price as number : null, image: value?.image })
      }
    }
    return { product, meta, form, card, pairs }
  })

  // Where each case type's renders live, by what the cards show (the AirPods
  // "Signature Earbuds" renders sit in a design's signature folder).
  const folderVotes = input.caseTypes.map(() => new Map<string, number>())
  for (const { pairs } of rows) {
    for (const pair of pairs) {
      const parts = renderParts(pair.image, img)
      if (parts && parts[2] === input.devices[pair.d].slug) folderVotes[pair.k].set(parts[1], (folderVotes[pair.k].get(parts[1]) ?? 0) + 1)
    }
  }
  const ctFolder = input.caseTypes.map((c, k) => {
    let best = c.slug
    let most = folderVotes[k].get(c.slug) ?? 0
    for (const [folder, votes] of folderVotes[k]) {
      if (votes > most) {
        best = folder
        most = votes
      }
    }
    return best
  })
  const ct: IndexCaseType[] = input.caseTypes.map((c, k) => [
    c.slug,
    c.name,
    ctFrom[k],
    ctForms[k],
    ctSold[k],
    ctPrice[k],
    ctGroups[k],
    ctFolder[k] === c.slug ? "" : ctFolder[k],
  ])
  // Per case type and form, computed once: products fall back to it.
  const formPrice = new Map<string, number | null>()
  const priceFor = (index: number, form: IndexForm) => {
    const key = `${index}|${form}`
    if (!formPrice.has(key)) formPrice.set(key, form === "product" ? ctFrom[index] : caseTypeFormPrice(input.caseTypes[index], form, ctFrom[index]))
    return formPrice.get(key)!
  }
  // Device indexes per form, in dv order, for notSold.
  const devicesOfForm = new Map<IndexForm, number[]>()
  input.devices.forEach((d, i) => {
    const form = formOfFamily(d.family)
    if (form) devicesOfForm.set(form, [...(devicesOfForm.get(form) ?? []), i])
  })

  const col: IndexCollection[] = input.collections.map((card) => [
    card.slug,
    card.title,
    indexImagePath(card.image, img) || indexImagePath(card.artwork, img),
    audienceMask(card.audiences),
  ])
  const colIndex = new Map<string, number>()
  input.collections.forEach((card, i) => {
    if (card.collection_id && !colIndex.has(card.collection_id)) colIndex.set(card.collection_id, i)
  })

  const p: IndexProduct[] = rows.map(({ product, meta, form, card, pairs }) => {
    const designSlug = typeof meta.design_slug === "string" ? meta.design_slug.trim() : ""
    const name = typeof meta.design_name === "string" && meta.design_name.trim()
      ? meta.design_name.trim()
      : (product.title ?? "").trim() || product.handle
    const slugs = productCaseTypeSlugs(meta, slugByName, validSlugs, designSlug ? input.designCaseTypes?.get(designSlug) : undefined)
    // The pairs a card has say exactly what is sold: price, device and case type.
    const bought = new Map<number, Map<number, number | null>>()
    for (const pair of pairs) bought.set(pair.k, (bought.get(pair.k) ?? new Map()).set(pair.d, pair.price))
    const caseTypes = slugs
      .map((slug) => ctIndex.get(slug))
      .filter((i): i is number => i !== undefined)
      // A manifest entry can name another form's construction (phone Signature
      // on an AirPods product); keep the ones made for this form, and with a
      // card's pairs only the ones it has a variant in.
      .filter((i) => form === "product" || !ctForms[i].length || ctForms[i].includes(form))
      .filter((i) => !pairs.length || bought.has(i))
      .sort((a, b) => a - b)
    const fromPrice = positive(card?.fromPrice)
      ? card!.fromPrice as number
      : minOrNull(caseTypes.map((i) => priceFor(i, form)).filter(positive))
    let notSold: number[] = []
    if (form !== "product" && Array.isArray(card?.devices)) {
      const sold = new Set(card!.devices as unknown[])
      notSold = (devicesOfForm.get(form) ?? []).filter((i) => !sold.has(input.devices[i].name))
    }

    // Per case type, only where it differs from the baseline (the product's
    // devices that case type is made for, at the case type's prices): the
    // devices it has no variant for, and its own prices when they differ.
    const facts: IndexCaseTypeFacts[] = []
    if (pairs.length) {
      const unsold = new Set(notSold)
      for (const k of caseTypes) {
        const own = bought.get(k)!
        const base = (devicesOfForm.get(form) ?? []).filter((d) => !unsold.has(d) && (!ctSold[k].length || ctSoldSet[k].has(d)))
        const missing = base.filter((d) => !own.has(d))
        const prices = new Map<number, number>()
        for (const d of base) {
          const price = own.get(d)
          if (price != null) prices.set(d, price)
        }
        if ([...prices].some(([d, price]) => price !== groupPrice(ctPrice[k], ctGroups[k], d))) facts.push([k, missing, ...ownPrices(prices)])
        else if (missing.length) facts.push([k, missing])
      }
    }

    // Its renders, when every pair's picture is <folder>/<ct folder>/<device>/1.webp
    // under img (1 = the design slug's folder); else 0 and the thumbnail stands in.
    let pics: 0 | 1 | string = 0
    const shown = pairs.filter((pair) => caseTypes.includes(pair.k))
    let folder: string | null = null
    for (const pair of shown) {
      const parts = renderParts(pair.image, img)
      if (!parts || parts[1] !== ctFolder[pair.k] || parts[2] !== input.devices[pair.d].slug || (folder != null && folder !== parts[0])) {
        folder = null
        break
      }
      folder = parts[0]
    }
    if (folder) pics = folder === designSlug ? 1 : folder
    // A thumbnail that is one of those renders is written as its [ct, dv].
    let thumb: IndexProduct[7] = indexImagePath(product.thumbnail, img)
    const render = folder && shown.find((pair) => thumb === `${folder}/${ctFolder[pair.k]}/${input.devices[pair.d].slug}/1.webp`)
    if (render) thumb = [render.k, render.d]

    return [
      product.handle,
      name,
      designSlug,
      form,
      AUD[readAudienceTag(meta)],
      caseTypes,
      product.collection_id ? colIndex.get(product.collection_id) ?? -1 : -1,
      thumb,
      fromPrice,
      notSold,
      pics,
      facts,
    ]
  })

  const search = input.search
  return {
    v: 2,
    img,
    ct,
    dv,
    col,
    p,
    cat: categories(input.menus, img),
    syn: search.synonyms.map((row) => [row.words, row.means]),
    sug: { w: search.suggest_women, m: search.suggest_men },
    help: [search.help_label, search.help_href],
    ph: search.placeholder,
  }
}
