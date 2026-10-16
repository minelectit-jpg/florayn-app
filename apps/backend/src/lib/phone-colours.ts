import { colourSlug, setPalette, type MockupSettings, type PaletteColour } from "./mockup-settings"

/**
 * Store-side projections of phone_colour_gallery (PHONE_COLOURS.md 3.4). Pure:
 * the routes do the reads, these shape what the storefront gets.
 *
 * The rules every reader follows:
 * - a row counts only for a live variant of a published product;
 * - a colour counts only while it is in that device's Mockup set (the palette);
 * - a variant shows colours only with a main row in the palette and at least
 *   one more colour; its options are the main colour first, then palette order.
 */

/** device slug -> its palette, for every saved set (also sets switched off in Studio). */
export function palettesByDevice(settings: Pick<MockupSettings, "sets">): Map<string, PaletteColour[]> {
  return new Map(settings.sets.map((set) => [set.device, setPalette(set)]))
}

export type ColourRowRead = { variant_id: string; device_slug: string; colour_slug: string; is_main: boolean }
export type VariantColours = { device: string; slugs: string[] }

/** variant ID -> its colour slugs ([0] = main), for variants with 2 or more colours only. */
export function variantColourOptions(rows: ColourRowRead[], liveVariantIds: Set<string>, palettes: Map<string, PaletteColour[]>): Map<string, VariantColours> {
  const grouped = new Map<string, ColourRowRead[]>()
  for (const row of rows) {
    if (!liveVariantIds.has(row.variant_id)) continue
    const list = grouped.get(row.variant_id) ?? []
    list.push(row)
    grouped.set(row.variant_id, list)
  }
  const out = new Map<string, VariantColours>()
  for (const [variantId, list] of grouped) {
    const device = list[0].device_slug
    const palette = palettes.get(device)
    if (!palette) continue
    const main = list.find((row) => row.is_main)
    if (!main || !palette.some(([slug]) => slug === main.colour_slug)) continue
    const extra = new Set(list.filter((row) => !row.is_main).map((row) => row.colour_slug))
    const slugs = [main.colour_slug, ...palette.map(([slug]) => slug).filter((slug) => slug !== main.colour_slug && extra.has(slug))]
    if (slugs.length >= 2) out.set(variantId, { device, slugs })
  }
  return out
}

/** The longest common prefix of the URLs that ends with "/" ("" for none). */
export function commonBase(urls: string[]): string {
  if (!urls.length) return ""
  let prefix = urls[0]
  for (const url of urls) {
    let i = 0
    while (i < prefix.length && i < url.length && prefix[i] === url[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) return ""
  }
  return prefix.slice(0, prefix.lastIndexOf("/") + 1)
}
/** The reader rule: a tail is a full URL or relative to `base`. */
export const expandTail = (base: string, tail: string) => (/^https?:\/\//.test(tail) ? tail : base + tail)

const isImage = (url: unknown): url is string => typeof url === "string" && url.length <= 4096 && /^https?:\/\//i.test(url)

export type ProductPhoneColours = {
  /** Only the colours this product uses, palette order. Entries can repeat a slug when two models name or paint it differently. */
  colours: PaletteColour[]
  /** variant ID -> indexes into `colours`; [0] = main (metadata.images), then palette order. */
  variants: Record<string, number[]>
  /** Longest common "/"-ending prefix of the URLs in `galleries`. */
  base: string
  /** Only the requested device's variants: variant ID -> extra colour slug -> URL tails. */
  galleries: Record<string, Record<string, string[]>>
}

export type GalleryRowRead = { variant_id: string; colour_slug: string; is_main: boolean; images: string[] | null }

/** Extra colour galleries of the given variants, keyed variant -> slug, kept to each variant's options. */
function extraGalleries(rows: GalleryRowRead[], options: Map<string, VariantColours>): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {}
  for (const row of rows) {
    const option = options.get(row.variant_id)
    if (!option || row.is_main || !option.slugs.slice(1).includes(row.colour_slug)) continue
    const urls = (row.images ?? []).filter(isImage)
    if (!urls.length) continue
    const byColour = out[row.variant_id] ?? {}
    byColour[row.colour_slug] = urls
    out[row.variant_id] = byColour
  }
  return out
}

/** Galleries -> { base, galleries with tails }. */
export function withTails(galleries: Record<string, Record<string, string[]>>): { base: string; galleries: Record<string, Record<string, string[]>> } {
  const base = commonBase(Object.values(galleries).flatMap((byColour) => Object.values(byColour).flat()))
  const out: Record<string, Record<string, string[]>> = {}
  for (const [variantId, byColour] of Object.entries(galleries)) {
    out[variantId] = {}
    for (const [slug, urls] of Object.entries(byColour)) out[variantId][slug] = urls.map((url) => url.slice(base.length))
  }
  return { base, galleries: out }
}

/**
 * The product page payload. `rows` are this product's rows without images;
 * `galleryRows` are the requested device's rows with images. `{}` when no
 * variant has 2 or more colours.
 */
export function productPhoneColours(input: {
  rows: ColourRowRead[]
  galleryRows: GalleryRowRead[]
  liveVariantIds: Set<string>
  settings: Pick<MockupSettings, "sets">
  device: string
}): ProductPhoneColours | Record<string, never> {
  const palettes = palettesByDevice(input.settings)
  const options = variantColourOptions(input.rows, input.liveVariantIds, palettes)
  if (!options.size) return {}
  // One table entry per (slug, name, hex), in set order then palette order.
  const used = new Map<string, Set<string>>()
  for (const { device, slugs } of options.values()) {
    const set = used.get(device) ?? new Set<string>()
    for (const slug of slugs) set.add(slug)
    used.set(device, set)
  }
  const colours: PaletteColour[] = []
  const indexOf = new Map<string, number>()
  const byDeviceSlug = new Map<string, number>()
  for (const [device, palette] of palettes) {
    const slugs = used.get(device)
    if (!slugs) continue
    for (const entry of palette) {
      if (!slugs.has(entry[0])) continue
      const key = entry.join("|")
      let index = indexOf.get(key)
      if (index === undefined) {
        index = colours.push(entry) - 1
        indexOf.set(key, index)
      }
      byDeviceSlug.set(`${device}|${entry[0]}`, index)
    }
  }
  const variants: Record<string, number[]> = {}
  for (const [variantId, { device, slugs }] of options) variants[variantId] = slugs.map((slug) => byDeviceSlug.get(`${device}|${slug}`)!)
  const deviceOptions = new Map([...options].filter(([, option]) => option.device === input.device))
  const { base, galleries } = withTails(extraGalleries(input.galleryRows, deviceOptions))
  return { colours, variants, base, galleries }
}

/** One variant's lazy payload: its extra colours' galleries (tails relative to `base`). */
export function variantPhoneColours(input: {
  rows: (ColourRowRead & { images: string[] | null })[]
  variantId: string
  settings: Pick<MockupSettings, "sets">
}): { base: string; galleries: Record<string, string[]> } {
  const options = variantColourOptions(input.rows, new Set([input.variantId]), palettesByDevice(input.settings))
  const { base, galleries } = withTails(extraGalleries(input.rows, options))
  return { base, galleries: galleries[input.variantId] ?? {} }
}

export type ShopPalette = {
  caseType: string
  /** The default colour's slug: the shop's colour-less (canonical) view. null when the model has no set. */
  default: string | null
  /** Palette order; available 1 = a live variant of a published product has pictures in that colour for this model and case type. */
  colours: [slug: string, name: string, hex: string, available: 0 | 1][]
}

/** The shop's palette for one model and case type. `rows` are (colour_slug, product_id, variant_id) of that pair. */
export function shopPalette(input: {
  settings: Pick<MockupSettings, "sets">
  device: string
  caseType: string
  rows: { colour_slug: string; product_id: string; variant_id: string }[]
  publishedProductIds: Set<string>
  liveVariantIds: Set<string>
}): ShopPalette {
  const set = input.settings.sets.find((s) => s.device === input.device)
  if (!set) return { caseType: input.caseType, default: null, colours: [] }
  // A deleted variant's rows stay behind (no module link): they never make a colour available.
  const available = new Set(input.rows
    .filter((row) => input.publishedProductIds.has(row.product_id) && input.liveVariantIds.has(row.variant_id))
    .map((row) => row.colour_slug))
  const palette = setPalette(set)
  const fallback = colourSlug(set.default_colour)
  return {
    caseType: input.caseType,
    default: palette.some(([slug]) => slug === fallback) ? fallback : palette[0]?.[0] ?? null,
    colours: palette.map(([slug, name, hex]) => [slug, name, hex, available.has(slug) ? 1 : 0]),
  }
}

/** colour_usage of GET /admin/mockups: device -> colour slug -> row count. */
export function colourUsage(rows: { device_slug: string; colour_slug: string }[]): Record<string, Record<string, number>> {
  const counts = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const byColour = counts.get(row.device_slug) ?? new Map<string, number>()
    byColour.set(row.colour_slug, (byColour.get(row.colour_slug) ?? 0) + 1)
    counts.set(row.device_slug, byColour)
  }
  return Object.fromEntries([...counts].map(([device, byColour]) => [device, Object.fromEntries(byColour)]))
}
