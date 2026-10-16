/**
 * Phone colour pictures on the storefront (PHONE_COLOURS.md). The phone colour
 * only changes which pictures are shown: the variant, price, stock and the bag
 * line never change with it.
 *
 * Pure helpers without imports, so the product page's client code can use them
 * without pulling the Medusa client into the browser. The server reads are in
 * lib/catalog.ts (getProductPhoneColours, getShopPhoneColours,
 * getVariantPhoneColours); the lazy route is app/api/phone-colours/[variant].
 */

/** One palette entry: web name, shopper-facing name, dot colour. */
export type PhoneColour = [slug: string, name: string, hex: string]

/** GET /store/phone-colours/product, as the product page passes it to the client. */
export type ProductPhoneColours = {
  /** Only the colours this product uses. */
  colours: PhoneColour[]
  /** variant ID -> indexes into `colours`; [0] is the main colour (metadata.images). */
  variants: Record<string, number[]>
  /** Shared prefix of every URL in `galleries`. */
  base: string
  /** The page's first model only: variant ID -> extra colour -> URL tails. */
  galleries: Record<string, Record<string, string[]>>
}

/** GET /store/phone-colours/variant/:id: one variant's extra colour galleries (URL tails). */
export type VariantPhoneColours = { base: string; galleries: Record<string, string[]> }

/** GET /store/phone-colours: the shop palette of one model and case type. */
export type ShopPhoneColours = {
  caseType: string
  /** The model's default colour: the shop's colour-less (canonical) view. */
  default: string | null
  /** Palette order; available 1 = a published design has pictures in it. */
  colours: [slug: string, name: string, hex: string, available: 0 | 1][]
}

/** A colour's web name, exactly the backend's COLOUR_SLUG: it starts with a letter. */
export const COLOUR_SLUG = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,39}$/
/** A Medusa variant ID, as the store's lazy colour route accepts it. */
export const VARIANT_ID = /^variant_[0-9A-Z]{26}$/
const HEX = /^#[0-9a-f]{6}$/i
/** The backend's NEUTRAL_SWATCH, for a dot whose colour is missing. */
const NEUTRAL = "#c9c9cf"
const MAX_COLOURS = 12
const MAX_PICTURES = 30

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const isTail = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096
const isUrl = (value: string) => /^https:\/\//.test(value)

/** The reader rule: a tail is a full URL or relative to `base`. */
export const expandTail = (base: string, tail: string) => (/^https?:\/\//.test(tail) ? tail : base + tail)

const dotColour = (hex: unknown) => (typeof hex === "string" && HEX.test(hex) ? hex.toLowerCase() : NEUTRAL)

function colourEntry(value: unknown): PhoneColour | null {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !COLOUR_SLUG.test(value[0])) return null
  const name = typeof value[1] === "string" && value[1].trim() ? value[1].trim().slice(0, 60) : value[0]
  return [value[0], name, dotColour(value[2])]
}

const baseOf = (value: unknown) => (typeof value === "string" && value.length <= 2048 && (!value || isUrl(value)) ? value : "")

/** colour web name -> URL tails that expand to https pictures (at most 30 each). */
function tailMap(value: unknown, base: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!isRecord(value)) return out
  for (const [slug, tails] of Object.entries(value).slice(0, MAX_COLOURS)) {
    if (!COLOUR_SLUG.test(slug) || !Array.isArray(tails)) continue
    const list = tails.filter((tail): tail is string => isTail(tail) && isUrl(expandTail(base, tail))).slice(0, MAX_PICTURES)
    if (list.length) out[slug] = list
  }
  return out
}

/**
 * The product payload, checked and kept to what the page uses: variants with 2
 * or more known colours, galleries only for those variants and their extra
 * colours. null when nothing is left (legacy pictures, `{}`, a failed read).
 */
export function readProductPhoneColours(raw: unknown): ProductPhoneColours | null {
  if (!isRecord(raw) || !Array.isArray(raw.colours) || !isRecord(raw.variants)) return null
  const colours = raw.colours.map(colourEntry)
  const variants: Record<string, number[]> = {}
  for (const [id, indexes] of Object.entries(raw.variants)) {
    if (!/^variant_[\w-]{1,64}$/.test(id) || !Array.isArray(indexes)) continue
    const seen = new Set<string>()
    const list = indexes.filter((i): i is number => {
      const entry = Number.isInteger(i) ? colours[i as number] : null
      if (!entry || seen.has(entry[0])) return false
      seen.add(entry[0])
      return true
    }).slice(0, MAX_COLOURS)
    if (list.length >= 2) variants[id] = list
  }
  if (!Object.keys(variants).length) return null
  // Re-index so the table holds only the entries a kept variant uses.
  const used = [...new Set(Object.values(variants).flat())].sort((a, b) => a - b)
  const index = new Map(used.map((old, i) => [old, i]))
  for (const id of Object.keys(variants)) variants[id] = variants[id].map((i) => index.get(i)!)
  const table = used.map((i) => colours[i]!)
  const base = baseOf(raw.base)
  const galleries: Record<string, Record<string, string[]>> = {}
  if (isRecord(raw.galleries)) {
    for (const [id, byColour] of Object.entries(raw.galleries)) {
      const extra = new Set(variants[id]?.slice(1).map((i) => table[i][0]))
      const kept = Object.fromEntries(Object.entries(tailMap(byColour, base)).filter(([slug]) => extra.has(slug)))
      if (Object.keys(kept).length) galleries[id] = kept
    }
  }
  return { colours: table, variants, base, galleries }
}

/** The lazy variant payload as sent to the browser (tails kept), or null. */
export function readVariantPhoneColours(raw: unknown): VariantPhoneColours | null {
  if (!isRecord(raw)) return null
  const base = baseOf(raw.base)
  return { base, galleries: tailMap(raw.galleries, base) }
}

/*
 * Browser side. The payloads were checked on the server (the readers above run
 * in lib/catalog.ts and the lazy route), so these only expand them. Written
 * without optional chaining: the browser build transpiles every `?.` into a
 * longer expression, and this code is in the product page's first load.
 */

/**
 * The lazy route's answer expanded to URLs: colour web name -> pictures. A
 * null-prototype map, so a "constructor" web name reads nothing instead of
 * Object.prototype's function (browser state only: never sent anywhere).
 */
export function expandGalleries(data: VariantPhoneColours): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null)
  for (const slug in data.galleries) out[slug] = data.galleries[slug].map((tail) => expandTail(data.base, tail))
  return out
}

export type PhoneColourView = {
  /** A variant's colours, main first; [] when it has fewer than 2 (every legacy pair). */
  optionsFor(variantId: string | undefined): PhoneColour[]
  /** The inline pictures of one extra colour (the page's first model only), or undefined. */
  inlineGallery(variantId: string | undefined, slug: string): string[] | undefined
  /** True when the page already carries this variant's extra colours. */
  hasInline(variantId: string | undefined): boolean
}

/** Expands the product payload on demand; pictures are expanded once per colour. */
export function phoneColourView(data: ProductPhoneColours | null | undefined): PhoneColourView {
  const variants = data ? data.variants : {}
  const galleries = data ? data.galleries : {}
  const expanded: Record<string, string[]> = {}
  return {
    optionsFor: (variantId) => (variantId && variants[variantId] ? variants[variantId].map((i) => data!.colours[i]) : []),
    inlineGallery(variantId, slug) {
      const tails = variantId && galleries[variantId] ? galleries[variantId][slug] : undefined
      // An array check, not a truthy one: "constructor" would read Object.prototype's function.
      if (!Array.isArray(tails)) return undefined
      const key = `${variantId}|${slug}`
      return expanded[key] || (expanded[key] = tails.map((tail) => expandTail(data!.base, tail)))
    },
    hasInline: (variantId) => !!(variantId && galleries[variantId]),
  }
}

/**
 * The colour to show: the shopper's preference when this pair has it, else
 * the pair's main colour. null when the pair has no colours (row hidden). The
 * preference survives model and case switches, so Black stays Black on every
 * model that has it and comes back after a case type without colours.
 */
export function settleColour(pref: string | null, options: string[]): string | null {
  if (options.length < 2) return null
  return pref && options.includes(pref) ? pref : options[0]
}

/** ?color=<web name> from a page address, or null. Read on the client only. */
export function colourFromQuery(search: string): string | null {
  const value = new URLSearchParams(search).get("color")
  return value && COLOUR_SLUG.test(value) ? value : null
}

/** The shop palette, checked: valid colours only, in palette order. */
export function readShopPhoneColours(raw: unknown): ShopPhoneColours | null {
  if (!isRecord(raw) || !Array.isArray(raw.colours)) return null
  const seen = new Set<string>()
  const colours: ShopPhoneColours["colours"] = []
  for (const value of raw.colours.slice(0, 24)) {
    const entry = colourEntry(value)
    if (!entry || seen.has(entry[0])) continue
    seen.add(entry[0])
    colours.push([...entry, Array.isArray(value) && value[3] === 1 ? 1 : 0])
  }
  const fallback = typeof raw.default === "string" && seen.has(raw.default) ? raw.default : null
  return { caseType: typeof raw.caseType === "string" ? raw.caseType : "", default: fallback, colours }
}

/** The colours a shop row offers: only available ones. Shown when 2 or more. */
export function shopRowColours(palette: ShopPhoneColours | null): ShopPhoneColours["colours"] {
  return palette?.colours.filter((c) => c[3] === 1) ?? []
}

/**
 * What a shop colour path does with its colour: "show" it, "redirect" the
 * default colour to the canonical colour-less path, "missing" (404) for an
 * unknown or unavailable colour, or "ignore" it when the palette could not be
 * read (the colour-less view is rendered instead).
 */
export function shopColourState(palette: ShopPhoneColours | null, slug: string): "show" | "redirect" | "missing" | "ignore" {
  if (!palette) return "ignore"
  if (!palette.colours.some((c) => c[0] === slug && c[3] === 1)) return "missing"
  return palette.default === slug ? "redirect" : "show"
}

/** /shop/<device>/[<case type>/][<colour>/][<page>/] */
export function shopPath(deviceSlug?: string | null, caseTypeSlug?: string | null, colourSlug?: string | null, page = 1): string {
  const base = !deviceSlug
    ? "/shop/"
    : caseTypeSlug
      ? `/shop/${deviceSlug}/${caseTypeSlug}/${colourSlug ? `${colourSlug}/` : ""}`
      : `/shop/${deviceSlug}/`
  return page > 1 ? `${base}${page}/` : base
}
