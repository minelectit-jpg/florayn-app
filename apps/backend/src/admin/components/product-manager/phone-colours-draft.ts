import type { DesignPalette, PaletteColour, PhoneColours } from "./shared"

/**
 * Product Manager > a case variant > Phone colour pictures (PHONE_COLOURS.md).
 * Pure helpers: the saved rows as an editable draft, the checks before saving
 * and the POST /admin/designs/:slug/colours body. The colour only changes the
 * pictures; `variant.metadata.images` stays the main gallery and is edited by
 * the variant editor (manager-variants), never here.
 */
export type ModelPalette = DesignPalette[string]
/** main: the colour the main gallery shows. extra: the other colours' galleries. */
export type ColourDraft = { main: string; extra: Record<string, string[]> }

/** The same limits the server applies (src/lib/phone-colour-input.ts). */
export const MAX_EXTRA_COLOURS = 11
export const MAX_COLOUR_PICTURES = 30

/** The model's palette, or null when it has no Mockup set with a usable colour. */
export function modelPalette(palette: DesignPalette | undefined, deviceSlug: string | null): ModelPalette | null {
  const entry = deviceSlug && palette && Object.prototype.hasOwnProperty.call(palette, deviceSlug) ? palette[deviceSlug] : null
  return entry && Array.isArray(entry.colours) && entry.colours.length ? entry : null
}

export const colourOf = (entry: ModelPalette, slug: string): PaletteColour | undefined => entry.colours.find((c) => c[0] === slug)
export const colourName = (entry: ModelPalette, slug: string) => colourOf(entry, slug)?.[1] ?? slug

/** Rows saved for a variant (main plus extras), as the variant list counts them. */
export const phoneColourCount = (saved: PhoneColours | undefined) => saved?.main ? 1 + Object.keys(saved.extra ?? {}).length : 0
/** The variant list's row meta: " · 3 phone colours", or "" without a main row. */
export function phoneColoursMeta(saved: PhoneColours | undefined): string {
  const n = phoneColourCount(saved)
  return n ? ` · ${n} phone ${n === 1 ? "colour" : "colours"}` : ""
}

/**
 * The saved rows as a draft. Colours no longer in the palette are left out and
 * listed in `stale` (shoppers never see them; saving removes them). `untagged`
 * means no usable main row is saved yet: the main gallery's colour is unknown,
 * so the draft suggests the model's default colour.
 */
export function colourDraft(saved: PhoneColours | undefined, entry: ModelPalette): { draft: ColourDraft; stale: string[]; untagged: boolean } {
  const slugs = entry.colours.map((c) => c[0])
  const extra = saved?.extra ?? {}
  const savedMain = saved?.main && slugs.includes(saved.main) ? saved.main : null
  const free = (slug: string) => !Object.prototype.hasOwnProperty.call(extra, slug)
  const main = savedMain
    ?? (slugs.includes(entry.default) && free(entry.default) ? entry.default : slugs.find(free) ?? (slugs.includes(entry.default) ? entry.default : slugs[0]))
  const draft: ColourDraft = { main, extra: {} }
  for (const slug of slugs) {
    if (slug !== main && Object.prototype.hasOwnProperty.call(extra, slug)) draft.extra[slug] = [...(extra[slug] ?? [])]
  }
  const stale = [
    ...(saved?.main && !savedMain ? [saved.main] : []),
    ...Object.keys(extra).filter((slug) => !slugs.includes(slug)),
  ]
  return { draft, stale, untagged: !savedMain }
}

const canon = (d: ColourDraft) => JSON.stringify([d.main, Object.keys(d.extra).sort().map((k) => [k, d.extra[k]])])
export const sameDraft = (a: ColourDraft, b: ColourDraft) => canon(a) === canon(b)

/** The colours "Add phone colour" offers: not the main and not added yet, palette order. */
export function addableColours(entry: ModelPalette, draft: ColourDraft): PaletteColour[] {
  if (Object.keys(draft.extra).length >= MAX_EXTRA_COLOURS) return []
  return entry.colours.filter(([slug]) => slug !== draft.main && !Object.prototype.hasOwnProperty.call(draft.extra, slug))
}

/** The draft's colours in palette order, main first. */
export function draftColours(entry: ModelPalette, draft: ColourDraft): PaletteColour[] {
  const main = colourOf(entry, draft.main)
  return [...(main ? [main] : []), ...entry.colours.filter(([slug]) => slug !== draft.main && Object.prototype.hasOwnProperty.call(draft.extra, slug))]
}

/** "Black (main) · Silver · Glacier" */
export const colourSummary = (entry: ModelPalette, draft: ColourDraft) =>
  draftColours(entry, draft).map(([slug, name]) => slug === draft.main ? `${name} (main)` : name).join(" · ")

/** The first reason the draft cannot be saved, or "". */
export function draftProblem(entry: ModelPalette, draft: ColourDraft): string {
  if (!colourOf(entry, draft.main)) return `${draft.main} is not a phone colour of this model. Choose one from its Mockup set.`
  if (Object.prototype.hasOwnProperty.call(draft.extra, draft.main)) return `${colourName(entry, draft.main)} already has its own pictures below. Remove that colour, or choose another main colour.`
  const extras = entry.colours.filter(([slug]) => Object.prototype.hasOwnProperty.call(draft.extra, slug))
  if (Object.keys(draft.extra).length !== extras.length) return "A colour below is not a phone colour of this model. Remove it."
  if (extras.length > MAX_EXTRA_COLOURS) return `Use up to ${MAX_EXTRA_COLOURS} extra phone colours.`
  for (const [slug, name] of extras) {
    const urls = draft.extra[slug]
    if (!urls.length) return `${name} has no pictures yet. Upload at least one, or remove the colour.`
    if (urls.length > MAX_COLOUR_PICTURES) return `${name} has more than ${MAX_COLOUR_PICTURES} pictures. Remove some.`
  }
  return ""
}

/**
 * The POST /admin/designs/:slug/colours body for one variant. replace: true, so
 * the saved rows become exactly this draft (removed and stale colours go).
 */
export function colourBody(variantId: string, entry: ModelPalette, draft: ColourDraft) {
  const galleries: Record<string, string[]> = {}
  for (const [slug] of entry.colours) {
    if (slug !== draft.main && Object.prototype.hasOwnProperty.call(draft.extra, slug)) galleries[slug] = [...draft.extra[slug]]
  }
  return { source: "manual" as const, variants: [{ variantId, main: draft.main, galleries, replace: true }] }
}
