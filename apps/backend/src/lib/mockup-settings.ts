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
  colours: string[]
  default_colour: string
  enabled: boolean
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

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)

function cleanSet(value: unknown): MockupSet | null {
  if (!isObject(value)) return null
  const colours = Array.isArray(value.colours) ? value.colours.filter((c): c is string => typeof c === "string" && COLOUR.test(c)) : []
  if (typeof value.device !== "string" || typeof value.base_url !== "string" || !colours.length) return null
  return {
    device: value.device,
    base_url: value.base_url,
    colours,
    default_colour: typeof value.default_colour === "string" && colours.includes(value.default_colour) ? value.default_colour : colours[0],
    enabled: value.enabled !== false,
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
    if (typeof raw.default_colour !== "string" || !colours.includes(raw.default_colour)) throw new Error(`${label}: the default colour must be one of its colours.`)
    if (typeof raw.enabled !== "boolean") throw new Error(`${label}: say whether it is on.`)
    return { device: raw.device, base_url: String(raw.base_url).replace(/\/+$/, ""), colours: colours as string[], default_colour: raw.default_colour, enabled: raw.enabled }
  })
  return { case_type: body.case_type, shots: shots as number[], image_size: body.image_size as number, quality: body.quality as number, supersample, sets }
}
