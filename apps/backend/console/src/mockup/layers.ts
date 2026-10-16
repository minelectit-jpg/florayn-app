// Browser side of Mockup Studio: load a set's layers from R2, place a design on
// the print template, and the small helpers the pages share (MOCKUP_STUDIO.md).
// Used by the workers and the page alike: nothing here may import React.
import { denoiseBlur, prepareDesign, type PreparedDesign, type ShotLayers, type ShotMeta } from "./compositor"

export type SetMeta = ShotMeta & { size: [number, number]; sizes: number[]; shots: { n: number; name: string }[] }
/** swatches: optional colour name -> "#rrggbb", the shop's phone colour dots (PHONE_COLOURS.md). */
export type MockupSet = { device: string; base_url: string; colours: string[]; default_colour: string; enabled: boolean; swatches?: Record<string, string> }
export type Settings = { case_type: string; shots: number[]; image_size: number; quality: number; supersample: boolean; sets: MockupSet[] }
/** Where the design sits on the template: zoom >= 1 over a cover fit, offsets as a fraction of the template. */
export type Placement = { zoom: number; ox: number; oy: number }
export const CENTERED: Placement = { zoom: 1, ox: 0, oy: 0 }
/** Template height / width of the sets made so far (iPhone 18 Pro Max), for when no meta is loaded yet. */
export const A_DEFAULT = 168.212 / 105.105
/** Shown when a worker dies or an allocation fails: on phones that is nearly always memory. */
export const OUT_OF_MEMORY = "The browser ran out of memory making the pictures. Close other tabs and try again."

const seg = (s: string) => encodeURIComponent(s)
export const tag = (n: number) => String(n).padStart(2, "0")

/** The packed size closest to the wanted one without going over, when possible. */
export const pickSize = (sizes: number[], want: number) => [...sizes].sort((a, b) => a - b).filter((s) => s <= want).pop() ?? Math.min(...sizes)
/** Design width on the template for a layer size: hq (3072 or 4096) for 2400, 2048 for 1200, 1024 below. */
export const designWidthFor = (size: number, hq: number) => (size >= 2400 ? hq : size >= 1200 ? 2048 : 1024)

const metas = new Map<string, Promise<SetMeta>>()
export function loadMeta(base: string, colour: string): Promise<SetMeta> {
  const url = `${base}/${seg(colour)}/meta.json`
  if (!metas.has(url)) {
    metas.set(url, fetch(url, { mode: "cors" }).then(async (r) => {
      if (!r.ok) throw new Error(`Layer info not found (${r.status}) at ${url}`)
      return r.json()
    }).catch((error) => {
      metas.delete(url)
      throw corsHint(error)
    }))
  }
  return metas.get(url)!
}

function corsHint(error: any) {
  // A blocked cross-origin read surfaces as a bare TypeError("Failed to fetch").
  if (error instanceof TypeError) return new Error("The browser could not read the layer files. Check the R2 bucket's CORS rule (MOCKUP_STUDIO.md).")
  return error
}

/** A 2D context, or the out-of-memory message when the browser refuses the canvas (iOS caps canvases at 16.7 MP). */
export function context2d(canvas: OffscreenCanvas, options?: CanvasRenderingContext2DSettings): OffscreenCanvasRenderingContext2D {
  const g = canvas.getContext("2d", options)
  if (!g) throw new Error(OUT_OF_MEMORY)
  return g
}

async function fetchLayer(url: string) {
  const response = await fetch(url, { mode: "cors" }).catch((e) => { throw corsHint(e) })
  if (!response.ok) throw new Error(`Layer missing (${response.status}): ${decodeURIComponent(url.split("/").slice(-1)[0])}`)
  return response.blob()
}

async function decodeLayer(blob: Blob, channels: number) {
  // colorSpaceConversion "none": the PNGs carry sRGB/gAMA chunks, but they hold raw data, not colours.
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  try {
    context2d(canvas, { willReadFrequently: true }).drawImage(bmp, 0, 0)
  } finally {
    bmp.close() // the pixels are in the canvas now: free the decoded copy before getImageData
  }
  const w = canvas.width, h = canvas.height, n = w * h
  const px = context2d(canvas, { willReadFrequently: true }).getImageData(0, 0, w, h).data
  canvas.width = canvas.height = 0 // release the backing store now, not at the next GC
  const out = new Uint8Array(n * channels)
  for (let i = 0; i < n; i++) for (let k = 0; k < channels; k++) out[i * channels + k] = px[i * 4 + k]
  return { data: out, w, h }
}

const bytes = async (url: string, channels: number) => decodeLayer(await fetchLayer(url), channels)

// Decoded layers stay in memory up to a byte budget (13 bytes per pixel: 600 px 4.7 MB, 1200 18.7 MB, 2400 75 MB).
let layerBudget = 240e6
const layerCache = new Map<string, { p: Promise<ShotLayers>; bytes: number }>()

/** Sets the layer cache's budget in bytes (per worker) and trims to it. */
export function configureLayerCache(bytes: number) {
  layerBudget = bytes
  trimLayers(null, 0)
}

// Oldest first; entries still loading count 0 and stay. The newest (keep) always stays, even over budget.
// extra: bytes about to be loaded, so room is made before they are allocated.
function trimLayers(keep: string | null, extra: number) {
  let total = extra
  const least = extra > 0 ? 0 : 1 // the entry about to load will be the newest
  for (const e of layerCache.values()) total += e.bytes
  for (const [key, e] of layerCache) {
    if (total <= layerBudget || layerCache.size <= least) break
    if (key === keep || !e.bytes) continue
    layerCache.delete(key)
    total -= e.bytes
  }
}

const LAYERS: [string, number][] = [["static", 3], ["light", 3], ["uv", 3], ["aux", 3], ["blur", 1]]

/**
 * One shot's layers, with the blur layer through denoiseBlur (once, here). Errors are not cached. The five files
 * download side by side; at 2400 px they decode one at a time (each decoded bitmap is 23 MB), otherwise the largest
 * memory peak of a phone ZIP.
 */
export function loadLayers(base: string, colour: string, size: number, shot: number): Promise<ShotLayers> {
  const key = `${base}|${colour}|${size}|${shot}`
  const hit = layerCache.get(key)
  if (hit) { layerCache.delete(key); layerCache.set(key, hit); return hit.p }
  const url = (layer: string) => `${base}/${seg(colour)}/${size}/${seg(`${tag(shot)} ${layer}.png`)}`
  const p = Promise.all(LAYERS.map(([name]) => fetchLayer(url(name)))).then(async (blobs): Promise<ShotLayers> => {
    // room is made only once every file is known to exist: a size that is not uploaded evicts nothing
    trimLayers(key, size * size * 13) // the sets are square
    let decoded: { data: Uint8Array; w: number; h: number }[] = []
    if (size >= 2400) for (let i = 0; i < blobs.length; i++) decoded.push(await decodeLayer(blobs[i], LAYERS[i][1]))
    else decoded = await Promise.all(blobs.map((b, i) => decodeLayer(b, LAYERS[i][1])))
    const [st, light, uv, aux, blur] = decoded
    return { w: st.w, h: st.h, static: st.data, light: light.data, uv: uv.data, aux: aux.data, blur: denoiseBlur(blur.data, aux.data, st.w, st.h) }
  })
  const entry = { p, bytes: 0 }
  layerCache.set(key, entry)
  p.then((layers) => {
    if (layerCache.get(key) !== entry) return
    entry.bytes = layers.w * layers.h * 13
    trimLayers(key, 0)
  }, () => { if (layerCache.get(key) === entry) layerCache.delete(key) })
  return p
}

/** The design drawn onto the print template (width px), cover fit then zoom/offset; white where it does not reach. */
export function placeDesign(img: CanvasImageSource & { width: number; height: number }, meta: ShotMeta, width: number, p: Placement) {
  const [tw, th] = meta.template_mm
  const W = Math.round(width), H = Math.round((width * th) / tw)
  const canvas = new OffscreenCanvas(W, H)
  const g = context2d(canvas, { willReadFrequently: true })
  g.fillStyle = "#fff"
  g.fillRect(0, 0, W, H)
  const s = Math.max(W / img.width, H / img.height) * p.zoom
  const dw = img.width * s, dh = img.height * s
  g.imageSmoothingQuality = "high"
  g.drawImage(img, (W - dw) / 2 + p.ox * W, (H - dh) / 2 + p.oy * H, dw, dh)
  const data = g.getImageData(0, 0, W, H).data
  canvas.width = canvas.height = 0
  return { data, w: W, h: H }
}

export function prepare(img: CanvasImageSource & { width: number; height: number }, meta: ShotMeta, width: number, p: Placement): PreparedDesign {
  const placed = placeDesign(img, meta, width, p)
  return prepareDesign(placed.data, placed.w, placed.h, 4, meta.ink_saturation)
}

/** iOS refuses canvases over 16,777,216 px; this stays under it after rounding. */
export const MAX_CANVAS_PX = 16_000_000

/**
 * A smaller copy, sharp: halve while the result stays at least w x h, then one last draw to w x h
 * (one big bilinear step would skip pixels and alias). Works in workers and on the page. maxPx caps every
 * in-between canvas (a step goes further than half when the half would be larger); w x h itself must fit it.
 */
export function downscale(src: CanvasImageSource & { width: number; height: number }, w: number, h: number, maxPx = Infinity): OffscreenCanvas {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
  let cur: OffscreenCanvas | null = null
  let cw = src.width, ch = src.height
  const draw = (from: CanvasImageSource, nw: number, nh: number) => {
    const c = new OffscreenCanvas(nw, nh)
    const g = context2d(c)
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = "high"
    g.drawImage(from, 0, 0, nw, nh)
    return c
  }
  while (cw / 2 >= w && ch / 2 >= h) {
    let nw = Math.round(cw / 2), nh = Math.round(ch / 2)
    if (nw * nh > maxPx) {
      const f = Math.sqrt(maxPx / (cw * ch))
      nw = Math.max(w, Math.floor(cw * f)); nh = Math.max(h, Math.floor(ch * f))
    }
    cw = nw; ch = nh
    const next = draw(cur ?? src, cw, ch)
    if (cur) cur.width = cur.height = 0 // the previous half is no longer needed
    cur = next
  }
  if (cur && cw === w && ch === h) return cur
  const out = draw(cur ?? src, w, h)
  if (cur) cur.width = cur.height = 0
  return out
}

/** Phones and small devices: smaller render sizes and budgets. Main thread only. */
export function isLowMemory(): boolean {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { deviceMemory?: number }
  return /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1) || (nav.deviceMemory ?? 8) <= 4
}

const probes = new Map<string, Promise<boolean | null>>()
/**
 * Whether the 2400 px layers are uploaded for a set colour (HEAD on the last shot's blur): false only when the server
 * answers that the file is not there, null when it cannot be told (network error). With false the page asks for
 * 1200 px straight away; the worker's own 2400 -> 1200 fallback stays the guard.
 */
export function probe2400(set: MockupSet, colour: string, lastShot: number): Promise<boolean | null> {
  const key = `${set.base_url}|${colour}`
  let p = probes.get(key)
  if (!p) {
    p = fetch(`${set.base_url}/${seg(colour)}/2400/${seg(`${tag(lastShot)} blur.png`)}`, { method: "HEAD", mode: "cors" })
      .then((r) => r.ok, () => null)
    probes.set(key, p)
  }
  return p
}

/**
 * The artwork coordinate under each pixel of a shot at its smallest size, for dragging on any angle.
 * U, V: 0..1 on the template (V = 0 at the bottom, as in Blender); M: print coverage 0..255.
 * J: typical [dU/dx, dU/dy, dV/dx, dV/dy] per layer pixel (x right, y down), signed medians over print pixels.
 * print: number of pixels with M >= 128.
 */
export type UvPick = { w: number; h: number; U: Float32Array; V: Float32Array; M: Uint8Array; J: [number, number, number, number]; print: number }

const uvPicks = new Map<string, Promise<UvPick>>()
export function loadUvPick(set: MockupSet, colour: string, shot: number): Promise<UvPick> {
  const key = `${set.base_url}|${colour}|${shot}`
  const hit = uvPicks.get(key)
  if (hit) { uvPicks.delete(key); uvPicks.set(key, hit); return hit }
  const p = (async () => {
    const meta = await loadMeta(set.base_url, colour)
    const size = Math.min(...meta.sizes)
    const url = (layer: string) => `${set.base_url}/${seg(colour)}/${size}/${seg(`${tag(shot)} ${layer}.png`)}`
    const [uv, aux] = await Promise.all([bytes(url("uv"), 3), bytes(url("aux"), 3)])
    return uvPickFrom(uv.data, aux.data, uv.w, uv.h)
  })()
  uvPicks.set(key, p)
  p.catch(() => { if (uvPicks.get(key) === p) uvPicks.delete(key) })
  while (uvPicks.size > 6) uvPicks.delete(uvPicks.keys().next().value!)
  return p
}

/** Builds a UvPick from the uv and aux layer bytes (exported for tests). */
export function uvPickFrom(uv: Uint8Array, aux: Uint8Array, w: number, h: number): UvPick {
  const n = w * h
  const U = new Float32Array(n), V = new Float32Array(n), M = new Uint8Array(n)
  let print = 0
  for (let i = 0; i < n; i++) {
    const j = i * 3
    U[i] = (uv[j] * 256 + uv[j + 1]) / 65535
    V[i] = (uv[j + 2] * 256 + aux[j]) / 65535
    M[i] = aux[j + 2]
    if (M[i] >= 128) print++
  }
  // neighbouring print pairs, every 4th pixel; a jump of 0.1 or more is a seam, not a slope
  const d: number[][] = [[], [], [], []]
  for (let i = 0; i < n; i += 4) {
    if (M[i] < 128) continue
    const x = i % w
    if (x < w - 1 && M[i + 1] >= 128) {
      const du = U[i + 1] - U[i], dv = V[i + 1] - V[i]
      if (Math.abs(du) < 0.1 && Math.abs(dv) < 0.1) { d[0].push(du); d[2].push(dv) }
    }
    if (i + w < n && M[i + w] >= 128) {
      const du = U[i + w] - U[i], dv = V[i + w] - V[i]
      if (Math.abs(du) < 0.1 && Math.abs(dv) < 0.1) { d[1].push(du); d[3].push(dv) }
    }
  }
  const median = (a: number[]) => { if (!a.length) return 0; a.sort((p, q) => p - q); return a[(a.length - 1) >> 1] }
  return { w, h, U, V, M, J: [median(d[0]), median(d[1]), median(d[2]), median(d[3])], print }
}

// Same as slugify in ui.tsx, kept here so the worker bundle does not pull in React.
const slugify = (s: string) => s.toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

/** "05 Camera close-up" -> "Camera close-up" */
export const shotTitle = (name: string) => name.replace(/^\d+\s*/, "")

const LABELS: [RegExp, string][] = [
  [/^front.*screen/i, "Screen"], [/^front/i, "Front"], [/protection|impact|drop/i, "Protection"], [/layers/i, "Layers"],
  [/magsafe/i, "MagSafe"], [/camera/i, "Camera"], [/bottom/i, "Bottom"], [/lying/i, "Lying"], [/side buttons/i, "Buttons"],
  [/side.*right/i, "Right side"], [/side.*left/i, "Left side"], [/hero/i, "Hero"], [/inside/i, "Inside"],
]
/** A short label for chips and the filmstrip: "08 Side - right (buttons)" -> "Right side". */
export function shotLabel(name: string) {
  const title = shotTitle(name)
  return LABELS.find(([re]) => re.test(title))?.[1] ?? title.split(" - ")[0]
}

/** "05 Camera close-up" -> "camera-close-up" (file names). */
export const angleSlug = (name: string) => slugify(shotTitle(name))

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
