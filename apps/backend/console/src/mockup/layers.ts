// Browser side of Mockup Studio: load a set's layers from R2, place a design on
// the print template, composite a shot and encode it (MOCKUP_STUDIO.md).
import { composite, prepareDesign, type PreparedDesign, type ShotLayers, type ShotMeta } from "./compositor"

export type SetMeta = ShotMeta & { size: [number, number]; sizes: number[]; shots: { n: number; name: string }[] }
export type MockupSet = { device: string; base_url: string; colours: string[]; default_colour: string; enabled: boolean }
export type Settings = { case_type: string; shots: number[]; image_size: number; quality: number; sets: MockupSet[] }
/** Where the design sits on the template: zoom >= 1 over a cover fit, offsets as a fraction of the template. */
export type Placement = { zoom: number; ox: number; oy: number }
export const CENTERED: Placement = { zoom: 1, ox: 0, oy: 0 }

const seg = (s: string) => encodeURIComponent(s)
export const tag = (n: number) => String(n).padStart(2, "0")

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

async function bytes(url: string, channels: number) {
  const response = await fetch(url, { mode: "cors" }).catch((e) => { throw corsHint(e) })
  if (!response.ok) throw new Error(`Layer missing (${response.status}): ${decodeURIComponent(url.split("/").slice(-1)[0])}`)
  // colorSpaceConversion "none": the PNGs carry sRGB/gAMA chunks, but they hold raw data, not colours.
  const bmp = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const g = canvas.getContext("2d", { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0)
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data
  bmp.close() // a closed bitmap reports 0 x 0, so sizes come from the canvas from here on
  const n = canvas.width * canvas.height
  const out = new Uint8Array(n * channels)
  for (let i = 0; i < n; i++) for (let k = 0; k < channels; k++) out[i * channels + k] = px[i * 4 + k]
  return { data: out, w: canvas.width, h: canvas.height }
}

// Layers of a handful of shots stay in memory (a 1200 px shot is ~13 MB decoded).
const layerCache = new Map<string, Promise<ShotLayers>>()
const LAYER_CACHE = 16
export function loadLayers(base: string, colour: string, size: number, shot: number): Promise<ShotLayers> {
  const key = `${base}|${colour}|${size}|${shot}`
  const hit = layerCache.get(key)
  if (hit) { layerCache.delete(key); layerCache.set(key, hit); return hit }
  const url = (layer: string) => `${base}/${seg(colour)}/${size}/${seg(`${tag(shot)} ${layer}.png`)}`
  const promise = Promise.all([bytes(url("static"), 3), bytes(url("light"), 3), bytes(url("uv"), 3), bytes(url("aux"), 3), bytes(url("blur"), 1)])
    .then(([st, light, uv, aux, blur]) => ({ w: st.w, h: st.h, static: st.data, light: light.data, uv: uv.data, aux: aux.data, blur: blur.data }))
  promise.catch(() => layerCache.delete(key))
  layerCache.set(key, promise)
  while (layerCache.size > LAYER_CACHE) layerCache.delete(layerCache.keys().next().value!)
  return promise
}

/** The design drawn onto the print template (width px), cover fit then zoom/offset; white where it does not reach. */
export function placeDesign(img: CanvasImageSource & { width: number; height: number }, meta: ShotMeta, width: number, p: Placement) {
  const [tw, th] = meta.template_mm
  const W = Math.round(width), H = Math.round((width * th) / tw)
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext("2d", { willReadFrequently: true })!
  g.fillStyle = "#fff"
  g.fillRect(0, 0, W, H)
  const s = Math.max(W / img.width, H / img.height) * p.zoom
  const dw = img.width * s, dh = img.height * s
  g.imageSmoothingQuality = "high"
  g.drawImage(img, (W - dw) / 2 + p.ox * W, (H - dh) / 2 + p.oy * H, dw, dh)
  return { data: g.getImageData(0, 0, W, H).data, w: W, h: H }
}

export function prepare(img: CanvasImageSource & { width: number; height: number }, meta: ShotMeta, width: number, p: Placement): PreparedDesign {
  const placed = placeDesign(img, meta, width, p)
  return prepareDesign(placed.data, placed.w, placed.h, 4, meta.ink_saturation)
}

export async function renderShot(set: MockupSet, colour: string, size: number, shot: number, design: PreparedDesign): Promise<ImageData> {
  const [meta, layers] = await Promise.all([loadMeta(set.base_url, colour), loadLayers(set.base_url, colour, size, shot)])
  const image = new ImageData(layers.w, layers.h)
  image.data.set(composite(layers, meta, design))
  return image
}

export function drawInto(canvas: HTMLCanvasElement, image: ImageData) {
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext("2d")!.putImageData(image, 0, 0)
}

/** Product image: the shot flattened on white (the product pages show white squares) as WebP. */
export async function toWebp(image: ImageData, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height)
  const g = canvas.getContext("2d")!
  const layer = new OffscreenCanvas(image.width, image.height)
  layer.getContext("2d")!.putImageData(image, 0, 0)
  g.fillStyle = "#fff"
  g.fillRect(0, 0, image.width, image.height)
  g.drawImage(layer, 0, 0)
  return canvas.convertToBlob({ type: "image/webp", quality: quality / 100 })
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Lets the page paint between heavy composites. */
export const breathe = () => new Promise((resolve) => setTimeout(resolve, 0))
