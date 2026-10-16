import { Modules } from "@medusajs/framework/utils"

/**
 * Admin > Mockup Studio settings (MOCKUP_STUDIO.md). Kept in the store metadata
 * like the other storefront preferences, so no migration.
 *
 * A mockup set is one phone model's packed Blender layers on R2:
 *   <base_url>/<colour>/meta.json and <base_url>/<colour>/<size>/<NN> <layer>.png
 * The admin composites a design onto them in the browser and uploads the result
 * as ordinary product images, so a set never changes how products are stored.
 */
export const MOCKUP_KEY = "florayn_mockups"

export type MockupSet = {
  device: string
  base_url: string
  /** Layer folder names = the shopper-facing phone colour names, in palette order. */
  colours: string[]
  /** THE default phone colour: Studio's main colour and the shop's colour-less view. */
  default_colour: string
  /** Studio on/off only; the storefront ignores it. */
  enabled: boolean
  /** Optional colour name -> "#rrggbb" for the shop's dots (PHONE_COLOURS.md). */
  swatches?: Record<string, string>
}
export type MockupSettings = {
  /** The case type the 3D case in the renders is; Mockup Studio sells that one. */
  case_type: string
  /** Shot numbers that go into the product gallery, in gallery order. */
  shots: number[]
  /** Shop images only (downloads are lossless 2400 px PNGs). */
  image_size: number
  /** WebP quality of the shop images, 50-100. */
  quality: number
  /** Make shop images from the 2400 px renders, then shrink them (sharper, about 4x slower to publish). */
  supersample: boolean
  sets: MockupSet[]
}

export const IMAGE_SIZES = [600, 1200, 2400]
export const MOCKUP_DEFAULTS: MockupSettings = {
  case_type: "signature",
  shots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  image_size: 1200,
  quality: 92,
  supersample: true,
  sets: [],
}

const COLOUR = /^[A-Za-z0-9][A-Za-z0-9 ()+.-]{0,39}$/
const MAX_SETS = 100

// --- phone colours (PHONE_COLOURS.md) ----------------------------------------------------------------
/**
 * A colour's web name: the key in phone_colour_gallery, the URLs and the API.
 * It always starts with a letter, so a shop page number is never read as one.
 */
export const COLOUR_SLUG = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,39}$/
/**
 * The one web name a plain object already has (Object.prototype.constructor):
 * slug-keyed maps on the storefront and in the console would read a function.
 */
const RESERVED_SLUG = "constructor"
const HEX = /^#[0-9a-f]{6}$/i
/** The console's slugify, exactly: "Deep Blue" -> "deep-blue", "Black" -> "black". */
export function colourSlug(name: string): string {
  return String(name ?? "").toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}
/** The console's first suggestion for a colour with no saved hex (keep in step with wizard/state.ts SWATCH). */
export const SWATCH_SUGGESTIONS: Record<string, string> = {
  "black": "#1d1d1f", "space black": "#2e2c2e", "silver": "#e3e4e5", "white": "#f5f5f0", "glacier": "#dbe7ee", "wine red": "#6b1f2e",
  "cosmic orange": "#f77e2d", "deep blue": "#34405a", "natural titanium": "#bfb9ad", "desert titanium": "#c8ad93", "black titanium": "#3c3b39",
  "white titanium": "#f2f1ed", "blue titanium": "#3f4a58", "midnight": "#232a31", "graphite": "#3b3a3e", "blue": "#b5c9da", "pink": "#f2c8cf",
  "green": "#c7d6c0", "yellow": "#f3e5a7", "purple": "#d9cfe6", "red": "#c41e3a", "lavender": "#cfc4e6", "sage": "#b9c3a6", "mist blue": "#b7c7d8",
  "teal": "#8fc4bf", "ultramarine": "#6f7fe0", "gold": "#f4e2c7", "deep purple": "#594f63", "starlight": "#f9f3ee",
}
export const NEUTRAL_SWATCH = "#c9c9cf"
/** A colour's dot: the saved hex, else the console's suggestion, else a neutral grey. */
export function swatchHex(set: Pick<MockupSet, "swatches">, name: string): string {
  const saved = set.swatches && Object.prototype.hasOwnProperty.call(set.swatches, name) ? set.swatches[name] : undefined
  if (typeof saved === "string" && HEX.test(saved)) return saved.toLowerCase()
  const key = name.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(SWATCH_SUGGESTIONS, key) ? SWATCH_SUGGESTIONS[key] : NEUTRAL_SWATCH
}
export type PaletteColour = [slug: string, name: string, hex: string]
/**
 * A set's colours as [slug, name, hex] in palette order. A colour whose web
 * name is invalid, reserved or already taken in the set (only possible in sets
 * saved before these checks) is skipped, so readers never see one slug twice.
 */
export function setPalette(set: MockupSet): PaletteColour[] {
  const seen = new Set<string>()
  const out: PaletteColour[] = []
  for (const name of set.colours) {
    const slug = colourSlug(name)
    if (!COLOUR_SLUG.test(slug) || slug === RESERVED_SLUG || seen.has(slug)) continue
    seen.add(slug)
    out.push([slug, name, swatchHex(set, name)])
  }
  return out
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)

/** Saved swatches, keeping only this set's colours with a valid hex. */
function cleanSwatches(value: unknown, colours: string[]): Record<string, string> | undefined {
  if (!isObject(value)) return undefined
  const out: Record<string, string> = {}
  for (const name of colours) {
    const hex = Object.prototype.hasOwnProperty.call(value, name) ? value[name] : undefined
    if (typeof hex === "string" && HEX.test(hex)) out[name] = hex.toLowerCase()
  }
  return Object.keys(out).length ? out : undefined
}

function cleanSet(value: unknown): MockupSet | null {
  if (!isObject(value)) return null
  const colours = Array.isArray(value.colours) ? value.colours.filter((c): c is string => typeof c === "string" && COLOUR.test(c)) : []
  if (typeof value.device !== "string" || typeof value.base_url !== "string" || !colours.length) return null
  const swatches = cleanSwatches(value.swatches, colours)
  return {
    device: value.device,
    base_url: value.base_url,
    colours,
    default_colour: typeof value.default_colour === "string" && colours.includes(value.default_colour) ? value.default_colour : colours[0],
    enabled: value.enabled !== false,
    ...(swatches ? { swatches } : {}),
  }
}

/** Saved metadata -> settings, falling back to defaults for anything missing or malformed. */
export function mockupSettings(value: unknown): MockupSettings {
  const saved = isObject(value) ? value : {}
  const shots = Array.isArray(saved.shots) ? saved.shots.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 64) : []
  return {
    case_type: typeof saved.case_type === "string" && saved.case_type ? saved.case_type : MOCKUP_DEFAULTS.case_type,
    shots: shots.length ? [...new Set(shots)] : [...MOCKUP_DEFAULTS.shots],
    image_size: IMAGE_SIZES.includes(saved.image_size as number) ? saved.image_size as number : MOCKUP_DEFAULTS.image_size,
    quality: Number.isInteger(saved.quality) && (saved.quality as number) >= 50 && (saved.quality as number) <= 100 ? saved.quality as number : MOCKUP_DEFAULTS.quality,
    supersample: typeof saved.supersample === "boolean" ? saved.supersample : MOCKUP_DEFAULTS.supersample,
    sets: Array.isArray(saved.sets) ? saved.sets.map(cleanSet).filter((s): s is MockupSet => s !== null) : [],
  }
}

export async function readMockupSettings(container: any) {
  const stores = await container.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"], take: 1 })
  const store = stores[0]
  return { store, settings: mockupSettings(store?.metadata?.[MOCKUP_KEY]) }
}

/** Strict check of what the admin screen saves. caseTypes/devices are the live catalog rows. */
export function validateMockupSettings(body: unknown, caseTypes: { slug: string }[], devices: { slug: string }[]): MockupSettings {
  if (!isObject(body)) throw new Error("Provide the Mockup Studio settings.")
  if (typeof body.case_type !== "string" || !caseTypes.some((c) => c.slug === body.case_type)) throw new Error("Choose the case type the mockups show.")
  const shots = body.shots
  if (!Array.isArray(shots) || !shots.length || shots.length > 30 || shots.some((n) => !Number.isInteger(n) || n < 1 || n > 64) || new Set(shots).size !== shots.length) {
    throw new Error("Choose at least one gallery shot, each once.")
  }
  if (!IMAGE_SIZES.includes(body.image_size as number)) throw new Error(`Image size must be one of ${IMAGE_SIZES.join(", ")}.`)
  if (!Number.isInteger(body.quality) || (body.quality as number) < 50 || (body.quality as number) > 100) throw new Error("Image quality must be a whole number from 50 to 100.")
  if (body.supersample !== undefined && typeof body.supersample !== "boolean") throw new Error("Say whether shop images are made from the 2400 px renders.")
  const supersample = body.supersample === undefined ? true : body.supersample
  if (!Array.isArray(body.sets) || body.sets.length > MAX_SETS) throw new Error(`Provide up to ${MAX_SETS} mockup sets.`)
  const seen = new Set<string>()
  const sets = body.sets.map((raw, i) => {
    const label = `Mockup set ${i + 1}`
    if (!isObject(raw)) throw new Error(`${label} is not valid.`)
    if (typeof raw.device !== "string" || !devices.some((d) => d.slug === raw.device)) throw new Error(`${label}: choose a model that exists.`)
    if (seen.has(raw.device)) throw new Error(`${label}: that model already has a mockup set.`)
    seen.add(raw.device)
    let url: URL
    try { url = new URL(String(raw.base_url)) } catch { throw new Error(`${label}: the layer folder address is not a URL.`) }
    // plain http only for a layer server on this computer (local testing)
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
    if ((url.protocol !== "https:" && !local) || String(raw.base_url).length > 500 || url.search || url.hash) throw new Error(`${label}: the layer folder must be an https address without ? or #.`)
    const colours = raw.colours
    if (!Array.isArray(colours) || !colours.length || colours.length > 12 || colours.some((c) => typeof c !== "string" || !COLOUR.test(c)) || new Set(colours).size !== colours.length) {
      throw new Error(`${label}: list 1 to 12 phone colours (letters, numbers, spaces), each once.`)
    }
    const slugs = new Set<string>()
    for (const name of colours as string[]) {
      const slug = colourSlug(name)
      if (!COLOUR_SLUG.test(slug)) throw new Error(`${label}: the colour "${name}" needs a name that starts with a letter. Rename it.`)
      if (slug === RESERVED_SLUG) throw new Error(`${label}: "${name}" cannot be a phone colour name. Rename it.`)
      if (slugs.has(slug)) throw new Error(`${label}: two colours make the same web name (${slug}). Rename one.`)
      slugs.add(slug)
    }
    if (typeof raw.default_colour !== "string" || !colours.includes(raw.default_colour)) throw new Error(`${label}: the default colour must be one of its colours.`)
    if (typeof raw.enabled !== "boolean") throw new Error(`${label}: say whether it is on.`)
    let swatches: Record<string, string> | undefined
    if (raw.swatches !== undefined && raw.swatches !== null) {
      if (!isObject(raw.swatches)) throw new Error(`${label}: the colour dots must map colour names to #rrggbb values.`)
      swatches = {}
      for (const [name, hex] of Object.entries(raw.swatches)) {
        if (!(colours as string[]).includes(name)) throw new Error(`${label}: "${name}" has a dot colour but is not one of its colours.`)
        if (typeof hex !== "string" || !HEX.test(hex)) throw new Error(`${label}: the dot colour of ${name} must look like #1d1d1f.`)
        swatches[name] = hex.toLowerCase()
      }
      if (!Object.keys(swatches).length) swatches = undefined
    }
    return { device: raw.device, base_url: String(raw.base_url).replace(/\/+$/, ""), colours: colours as string[], default_colour: raw.default_colour, enabled: raw.enabled, ...(swatches ? { swatches } : {}) }
  })
  return { case_type: body.case_type, shots: shots as number[], image_size: body.image_size as number, quality: body.quality as number, supersample, sets }
}
