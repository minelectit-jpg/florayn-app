import { MedusaError } from "@medusajs/framework/utils"

import { COLOUR_SLUG } from "./mockup-settings"
import { imageUrls } from "./product-manager-input"

/**
 * Phone colour pictures (PHONE_COLOURS.md): request validation and the row plan
 * of POST /admin/designs/:slug/colours. No I/O, so it is unit-tested directly;
 * a refusal is a MedusaError INVALID_DATA (400) with a message for the admin.
 *
 * A variant's main gallery stays `variant.metadata.images`; `main` only says
 * which phone colour it shows. `galleries` holds the extra colours.
 */
export type ColourSource = "mockup_studio" | "manual"
export type ColourGalleryInput = {
  /** Address a variant by its ID, or by (case type slug, device slug). */
  variantId?: string
  caseType?: string
  device?: string
  /** Colour slug of metadata.images. */
  main: string
  /** Extra colours only: colour slug -> 1-30 https URLs. */
  galleries: Record<string, string[]>
  /** true: remove this variant's rows that are not listed. */
  replace: boolean
}

export const MAX_COLOUR_VARIANTS = 100
export const MAX_EXTRA_COLOURS = 11
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VARIANT_ID = /^variant_[0-9A-Za-z]{1,64}$/

/** A readable 400: the message is shown to the admin as is. */
const invalid = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message)
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key)

export function isColourSlug(value: unknown): value is string {
  return typeof value === "string" && COLOUR_SLUG.test(value)
}

/** The request body -> validated input. Throws a readable Error. */
export function colourGalleriesInput(raw: unknown): { source: ColourSource; variants: ColourGalleryInput[] } {
  if (!isObject(raw)) throw invalid("Send the phone colour pictures to save.")
  const source = raw.source === undefined ? "manual" : raw.source
  if (source !== "mockup_studio" && source !== "manual") throw invalid("Say where the pictures come from (mockup_studio or manual).")
  if (!Array.isArray(raw.variants) || !raw.variants.length || raw.variants.length > MAX_COLOUR_VARIANTS) {
    throw invalid(`Send phone colours for 1 to ${MAX_COLOUR_VARIANTS} variants at a time.`)
  }
  const seen = new Set<string>()
  const variants = raw.variants.map((entry: unknown, i: number): ColourGalleryInput => {
    const label = `Variant ${i + 1}`
    if (!isObject(entry)) throw invalid(`${label} is not valid.`)
    const byId = entry.variantId !== undefined && entry.variantId !== null
    const byPair = entry.caseType !== undefined || entry.device !== undefined
    if (byId && byPair) throw invalid(`${label}: give its variant ID or its case type and model, not both.`)
    if (!byId && !byPair) throw invalid(`${label}: give its variant ID, or its case type and model.`)
    let address: Pick<ColourGalleryInput, "variantId" | "caseType" | "device">
    let key: string
    if (byId) {
      if (typeof entry.variantId !== "string" || !VARIANT_ID.test(entry.variantId)) throw invalid(`${label}: the variant ID is not valid.`)
      address = { variantId: entry.variantId }
      key = entry.variantId
    } else {
      if (typeof entry.caseType !== "string" || entry.caseType.length > 160 || !SLUG.test(entry.caseType)
        || typeof entry.device !== "string" || entry.device.length > 160 || !SLUG.test(entry.device)) {
        throw invalid(`${label}: give the case type and model as web names, e.g. signature and iphone-18-pro-max.`)
      }
      address = { caseType: entry.caseType, device: entry.device }
      key = `${entry.caseType}|${entry.device}`
    }
    if (seen.has(key)) throw invalid(`${label}: this variant is listed twice.`)
    seen.add(key)
    if (!isColourSlug(entry.main)) throw invalid(`${label}: the main colour must be a colour web name such as black or deep-blue.`)
    const rawGalleries = entry.galleries === undefined ? {} : entry.galleries
    if (!isObject(rawGalleries)) throw invalid(`${label}: the colour galleries must map colour web names to picture lists.`)
    const names = Object.keys(rawGalleries)
    if (names.length > MAX_EXTRA_COLOURS) throw invalid(`${label}: use up to ${MAX_EXTRA_COLOURS} extra phone colours.`)
    const galleries: Record<string, string[]> = {}
    for (const name of names) {
      if (!isColourSlug(name)) throw invalid(`${label}: "${name}" is not a colour web name such as silver or deep-blue.`)
      if (name === entry.main) throw invalid(`${label}: ${name} is the main colour; its pictures are the main gallery.`)
      let urls: string[]
      try { urls = imageUrls(rawGalleries[name]) } catch (error: any) { throw invalid(`${label}, ${name}: ${error.message}`) }
      if (!urls.length) throw invalid(`${label}, ${name}: add at least one picture, or leave the colour out.`)
      galleries[name] = urls
    }
    if (entry.replace !== undefined && typeof entry.replace !== "boolean") throw invalid(`${label}: say whether colours that are not listed are removed (replace true or false).`)
    return { ...address, main: entry.main, galleries, replace: entry.replace === true }
  })
  return { source, variants }
}

/** A stored phone_colour_gallery row (the fields the plan needs). */
export type ColourRow = {
  id: string
  product_id: string
  variant_id: string
  device_slug: string
  case_type_slug: string
  colour_slug: string
  is_main: boolean
  images: string[] | null
  source: ColourSource
}
export type NewColourRow = Omit<ColourRow, "id">
/** One input mapped to its owned variant. */
export type ResolvedColourVariant = {
  variantId: string
  productId: string
  deviceSlug: string
  caseTypeSlug: string
  main: string
  galleries: Record<string, string[]>
  replace: boolean
}
export type ColourRowPlan = {
  /** Row IDs to hard-delete. */
  remove: string[]
  /** Updates that end with is_main false (extra galleries, a demoted main). Applied before `promote`. */
  update: { id: string; is_main: false; images: string[]; source: ColourSource }[]
  /** Existing rows that become (or stay, with a change) the main row. */
  promote: { id: string; is_main: true; images: null; source: ColourSource }[]
  /** New rows. Applied last, after the old main rows are gone or demoted. */
  create: NewColourRow[]
  /** Rows the listed colours now have (main + extras). */
  saved: number
}

const sameList = (a: string[] | null, b: string[]) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i])

/**
 * What to write so each listed variant ends with exactly one main row (its
 * `main`), one row per listed extra colour and, with `replace`, nothing else.
 * An old main row of another colour that is not listed has no pictures of its
 * own, so it is always removed.
 */
export function planColourRows(existing: ColourRow[], variants: ResolvedColourVariant[], source: ColourSource): ColourRowPlan {
  const plan: ColourRowPlan = { remove: [], update: [], promote: [], create: [], saved: 0 }
  for (const v of variants) {
    const rows = existing.filter((row) => row.variant_id === v.variantId)
    const bySlug = new Map(rows.map((row) => [row.colour_slug, row]))
    const base = { product_id: v.productId, variant_id: v.variantId, device_slug: v.deviceSlug, case_type_slug: v.caseTypeSlug }
    for (const row of rows) {
      if (row.colour_slug === v.main || own(v.galleries, row.colour_slug)) continue
      if (row.is_main || v.replace) plan.remove.push(row.id)
    }
    for (const [slug, images] of Object.entries(v.galleries)) {
      const row = bySlug.get(slug)
      if (!row) plan.create.push({ ...base, colour_slug: slug, is_main: false, images, source })
      else if (row.is_main || row.source !== source || !sameList(row.images, images)) plan.update.push({ id: row.id, is_main: false, images, source })
    }
    const main = bySlug.get(v.main)
    if (!main) plan.create.push({ ...base, colour_slug: v.main, is_main: true, images: null, source })
    else if (!main.is_main || (main.images?.length ?? 0) > 0 || main.source !== source) plan.promote.push({ id: main.id, is_main: true, images: null, source })
    plan.saved += 1 + Object.keys(v.galleries).length
  }
  return plan
}
