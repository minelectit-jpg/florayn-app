// Mockup Studio > New product: the wizard's state, its reducer, validation and the
// placement maths (MOCKUP_STUDIO.md). Pure: no React, no workers, no requests.
import { angleSlug, CENTERED, tag, type MockupSet, type Placement, type SetMeta } from "../../../mockup/layers"
import { slugify } from "../../../ui"

export type StepId = "design" | "models" | "placement" | "details" | "review"
export const STEPS: { id: StepId; label: string }[] = [
  { id: "design", label: "Design" }, { id: "models", label: "Models" }, { id: "placement", label: "Placement" },
  { id: "details", label: "Details" }, { id: "review", label: "Review & publish" },
]
export const stepIndex = (id: StepId) => STEPS.findIndex((s) => s.id === id)
export const NEW_COLLECTION = "__new__"

/**
 * The uploaded design. across: source pixels across the print; scale: how much the detail worker shrank it (1: not at
 * all); reduced: scale < 1; preview: long side <= 640.
 */
export type DesignFile = { file: File; url: string; w: number; h: number; across: number; scale: number; reduced: boolean; version: number; preview: ImageBitmap }
export type Pick = { on: boolean; colour: string }
export type Details = {
  name: string; nameTouched: boolean; slug: string; slugTouched: boolean; slugOpen: boolean
  /** "" (none) | an existing collection's title | NEW_COLLECTION */
  collection: string; newCollection: string
  stock: string; description: string; status: "draft" | "published"
}
export type State = {
  step: StepId; reached: number; dir: 1 | -1; fromReview: boolean; showErrors: boolean
  design: DesignFile | null; reading: string | null; designError: string
  /** device slug -> choice; picks of sets that are no longer enabled are ignored */
  picks: Record<string, Pick>
  /** what the stage shows */
  focus: { device: string | null; shot: number }
  /** past: undo stack (30); anchor: the placement when the current gesture began */
  placement: Placement; past: Placement[]; anchor: Placement | null
  details: Details
  /** downloads */
  background: "white" | "transparent"
}

export type MetaState = { status: "loading" } | { status: "ready"; meta: SetMeta; full: boolean | null } | { status: "error"; message: string }
export type SlugState = "idle" | "checking" | "free" | "taken" | "invalid" | "unknown"

const EMPTY_DETAILS: Details = {
  name: "", nameTouched: false, slug: "", slugTouched: false, slugOpen: false,
  collection: "", newCollection: "", stock: "0", description: "", status: "draft",
}

export function initialState(): State {
  return {
    step: "design", reached: 0, dir: 1, fromReview: false, showErrors: false,
    design: null, reading: null, designError: "",
    picks: {}, focus: { device: null, shot: 0 },
    placement: CENTERED, past: [], anchor: null,
    details: { ...EMPTY_DETAILS }, background: "white",
  }
}

export type Action =
  | { type: "go"; step: StepId; fromReview?: boolean }
  | { type: "design/reading"; name: string }
  | { type: "design/ready"; design: DesignFile; firstDevice?: { device: string; colour: string } | null }
  | { type: "design/error"; message: string }
  /** the same design sent to the workers again: new picture keys, so nothing made from another image is reused */
  | { type: "design/version"; version: number }
  | { type: "design/remove" }
  | { type: "pick/toggle"; device: string; colour: string }
  | { type: "pick/all"; on: boolean; devices: { device: string; colour: string }[] }
  | { type: "pick/colour"; device: string; colour: string }
  | { type: "focus"; device?: string; shot?: number }
  | { type: "place/begin" }
  | { type: "place/set"; p: Placement }
  | { type: "place/end" }
  | { type: "place/apply"; p: Placement }
  | { type: "place/undo" }
  | { type: "place/reset" }
  | { type: "details"; patch: Partial<Details> }
  | { type: "errors/show" }
  | { type: "background"; value: "white" | "transparent" }
  | { type: "again"; collectionTitle?: string }

/** "muse_honey-glow 47.png" -> "Muse Honey Glow 47" */
export function titleFromFile(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/(^|\s)(\p{Ll})/gu, (_, space: string, c: string) => space + c.toUpperCase())
}

const samePlacement = (a: Placement, b: Placement) => placementKey(a) === placementKey(b)
const UNDO = 30
/** The backend's limits on a design's URL and on starting stock. */
export const SLUG_MAX = 150
export const STOCK_MAX = 10_000_000
/** The URL made from the title: at most SLUG_MAX characters, never ending in a dash. */
const autoSlug = (name: string) => slugify(name).slice(0, SLUG_MAX).replace(/-+$/, "")

function pushPast(past: Placement[], p: Placement) {
  return [...past, p].slice(-UNDO)
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "go": {
      const idx = stepIndex(a.step), cur = stepIndex(s.step)
      return { ...s, step: a.step, dir: idx >= cur ? 1 : -1, reached: Math.max(s.reached, idx), fromReview: Boolean(a.fromReview), showErrors: false }
    }
    case "design/reading":
      return { ...s, reading: a.name, designError: "" }
    case "design/ready": {
      const d = { ...s.details }
      if (!d.nameTouched) d.name = titleFromFile(a.design.file.name)
      if (!d.slugTouched) d.slug = autoSlug(d.name)
      const picks = a.firstDevice ? { ...s.picks, [a.firstDevice.device]: { on: true, colour: a.firstDevice.colour } } : s.picks
      return { ...s, design: a.design, reading: null, designError: "", placement: CENTERED, past: [], anchor: null, details: d, picks }
    }
    case "design/error":
      return { ...s, reading: null, designError: a.message }
    case "design/version":
      return s.design ? { ...s, design: { ...s.design, version: a.version } } : s
    case "design/remove":
      return { ...s, design: null, reading: null, reached: 0, placement: CENTERED, past: [], anchor: null }
    case "pick/toggle": {
      const cur = s.picks[a.device] ?? { on: false, colour: a.colour }
      return { ...s, picks: { ...s.picks, [a.device]: { ...cur, on: !cur.on } } }
    }
    case "pick/all": {
      const picks = { ...s.picks }
      for (const d of a.devices) picks[d.device] = { colour: picks[d.device]?.colour ?? d.colour, on: a.on }
      return { ...s, picks }
    }
    case "pick/colour":
      return { ...s, picks: { ...s.picks, [a.device]: { on: true, colour: a.colour } }, focus: { ...s.focus, device: a.device } }
    case "focus":
      return { ...s, focus: { device: a.device ?? s.focus.device, shot: a.shot ?? s.focus.shot } }
    case "place/begin":
      return s.anchor ? s : { ...s, anchor: s.placement }
    case "place/set":
      return samePlacement(s.placement, a.p) ? s : { ...s, placement: a.p }
    case "place/end":
      if (!s.anchor) return s
      return { ...s, anchor: null, past: samePlacement(s.anchor, s.placement) ? s.past : pushPast(s.past, s.anchor) }
    case "place/apply":
      if (samePlacement(s.placement, a.p)) return s
      return { ...s, placement: a.p, anchor: null, past: pushPast(s.past, s.anchor ?? s.placement) }
    case "place/undo": {
      if (!s.past.length) return s
      return { ...s, placement: s.past[s.past.length - 1], past: s.past.slice(0, -1), anchor: null }
    }
    case "place/reset":
      return reducer(s, { type: "place/apply", p: CENTERED })
    case "details": {
      const d = { ...s.details, ...a.patch }
      if (a.patch.name !== undefined && !d.slugTouched) d.slug = autoSlug(d.name)
      return { ...s, details: d }
    }
    case "errors/show":
      return { ...s, showErrors: true }
    case "background":
      return { ...s, background: a.value }
    case "again": {
      const d: Details = { ...EMPTY_DETAILS, stock: s.details.stock, status: s.details.status, collection: s.details.collection, newCollection: s.details.newCollection }
      if (a.collectionTitle) { d.collection = a.collectionTitle; d.newCollection = "" }
      return {
        ...s, step: "design", reached: 0, dir: -1, fromReview: false, showErrors: false,
        design: null, reading: null, designError: "", focus: { device: s.focus.device, shot: 0 },
        placement: CENTERED, past: [], anchor: null, details: d,
      }
    }
  }
}

// --- placement maths ------------------------------------------------------------------------------
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** Source pixels across the print for a template aspect A (height / width). */
export const across = (img: { w: number; h: number }, A: number) => Math.min(img.w, img.h / A)
/** How far the design may move (fractions of the template) and still cover the print of every model in As. */
export function limits(zoom: number, img: { w: number; h: number }, As: number[]) {
  let x = Infinity, y = Infinity
  for (const A of As) {
    const r = (img.w / img.h) * A
    x = Math.min(x, (zoom * Math.max(1, r) - 1) / 2)
    y = Math.min(y, (zoom * Math.max(1, 1 / r) - 1) / 2)
  }
  return { x: Math.max(0, x), y: Math.max(0, y) }
}
/** Zoom 1-2.5 and offsets inside the limits: the design always covers the whole print, so no white edges. */
export function clampPlacement(p: Placement, img: { w: number; h: number }, As: number[]): Placement {
  const zoom = clamp(p.zoom, 1, 2.5), l = limits(zoom, img, As)
  return { zoom, ox: clamp(p.ox, -l.x, l.x), oy: clamp(p.oy, -l.y, l.y) }
}
/** Zoom to z keeping the template point a (fractions, y down) where it is; null: about the design's centre. */
export function zoomAbout(p: Placement, z: number, a: { x: number; y: number } | null): Placement {
  if (!a) return { ...p, zoom: z }
  const k = z / p.zoom
  return { zoom: z, ox: a.x - (a.x - (0.5 + p.ox)) * k - 0.5, oy: a.y - (a.y - (0.5 + p.oy)) * k - 0.5 }
}
export const placementKey = (p: Placement) => `${p.zoom.toFixed(3)}|${p.ox.toFixed(4)}|${p.oy.toFixed(4)}`
/** 3 Sharp, 2 Good, 1 Low: source pixels across the visible print (0.5 % slack, so a 3000 x 4800 design at 5 : 8 counts as 3000). */
export const sharpness = (acr: number, zoom: number) => { const e = (acr / zoom) * 1.005; return e >= 3000 ? 3 : e >= 2000 ? 2 : 1 }

// --- validation -----------------------------------------------------------------------------------
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const slugValid = (slug: string) => SLUG.test(slug)

export function fieldErrors(s: State, slugState: SlugState): { name?: string; slug?: string; newCollection?: string; stock?: string } {
  const d = s.details, out: { name?: string; slug?: string; newCollection?: string; stock?: string } = {}
  if (!d.name.trim()) out.name = "Enter the product title."
  if (!SLUG.test(d.slug)) out.slug = "Use lowercase letters, numbers and dashes in the URL."
  else if (d.slug.length > SLUG_MAX) out.slug = "Keep the URL to 150 characters or fewer."
  else if (slugState === "taken") out.slug = "This URL is already used by another design."
  if (d.collection === NEW_COLLECTION && !d.newCollection.trim()) out.newCollection = "Enter the new collection's name."
  if (!/^\d+$/.test(d.stock.trim())) out.stock = "Enter a whole number, 0 or more."
  else if (Number(d.stock.trim()) > STOCK_MAX) out.stock = "Enter a whole number from 0 to 10,000,000."
  return out
}

export function stepErrors(s: State, ctx: { chosen: MockupSet[]; metas: Record<string, MetaState>; colourOf: (set: MockupSet) => string; slugState: SlugState; deviceName: (slug: string) => string }): Partial<Record<StepId, string>> {
  const out: Partial<Record<StepId, string>> = {}
  if (!s.design) out.design = "Add a design to continue."
  if (!ctx.chosen.length) out.models = "Choose at least one model to continue."
  else {
    const failed = ctx.chosen.find((set) => ctx.metas[`${set.device}|${ctx.colourOf(set)}`]?.status === "error")
    if (failed) out.models = `${ctx.deviceName(failed.device)}'s mockups could not be loaded. Untick it or press Retry.`
  }
  const f = fieldErrors(s, ctx.slugState)
  const first = f.name ?? f.slug ?? f.newCollection ?? f.stock
  if (first) out.details = first
  return out
}

/** The first step before `upTo` with an error, if any (a step can be opened when none before it has one). */
export function blockedBy(errors: Partial<Record<StepId, string>>, upTo: number): StepId | null {
  for (let i = 0; i < upTo; i++) if (errors[STEPS[i].id]) return STEPS[i].id
  return null
}

// --- phone colours --------------------------------------------------------------------------------
export const SWATCH: Record<string, string> = {
  "black": "#1d1d1f", "space black": "#2e2c2e", "silver": "#e3e4e5", "white": "#f5f5f0", "glacier": "#dbe7ee", "wine red": "#6b1f2e",
  "cosmic orange": "#f77e2d", "deep blue": "#34405a", "natural titanium": "#bfb9ad", "desert titanium": "#c8ad93", "black titanium": "#3c3b39",
  "white titanium": "#f2f1ed", "blue titanium": "#3f4a58", "midnight": "#232a31", "graphite": "#3b3a3e", "blue": "#b5c9da", "pink": "#f2c8cf",
  "green": "#c7d6c0", "yellow": "#f3e5a7", "purple": "#d9cfe6", "red": "#c41e3a", "lavender": "#cfc4e6", "sage": "#b9c3a6", "mist blue": "#b7c7d8",
  "teal": "#8fc4bf", "ultramarine": "#6f7fe0", "gold": "#f4e2c7", "deep purple": "#594f63", "starlight": "#f9f3ee",
}
export function swatchColour(name: string) {
  const known = SWATCH[name.trim().toLowerCase()]
  if (known) return known
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360}, 14%, 72%)`
}

// --- file names -----------------------------------------------------------------------------------
/** The first part of every download's name: the URL, else the title, else the file name. */
export function baseName(d: { slug: string; name: string }, fileName?: string) {
  return slugify(d.slug) || slugify(d.name) || slugify((fileName ?? "").replace(/\.[a-z0-9]+$/i, "")) || "mockup"
}
/** "05-camera-close-up_2400.png" */
export const entryName = (n: number, shotName: string, size: number) => `${tag(n)}-${angleSlug(shotName)}_${size}.png`
/** "muse-honey-glow_iphone-18-pro-max_glacier_05-camera-close-up_2400.png" */
export const pngName = (base: string, device: string, colour: string, n: number, shotName: string, size: number) => `${base}_${device}_${slugify(colour)}_${entryName(n, shotName, size)}`
export const modelZipName = (base: string, device: string, colour: string) => `${base}_${device}_${slugify(colour)}_mockups.zip`
export const allZipName = (base: string) => `${base}_mockups.zip`

/** "About 3 min left" / "Less than a minute left" */
export function etaText(msEach: number, left: number) {
  const ms = msEach * left
  return ms < 60_000 ? "Less than a minute left" : `About ${Math.round(ms / 60_000)} min left`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
