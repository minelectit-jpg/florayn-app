// Renders mockup shots off the main thread (MOCKUP_STUDIO.md). One render at a time,
// the lowest prio first (ties by arrival); a job older than the newest generation
// of its lane is dropped, also part-way through a long render, so dragging never
// queues up stale renders. A job's layer download does not hold the worker: the
// next job whose layers are ready renders meanwhile. Jobs that arrive before the
// design (a fresh worker after a crash) wait for it.
import { composite, type PreparedDesign, type ShotLayers, type ShotMeta } from "./compositor"
import { configureLayerCache, context2d, downscale, loadLayers, loadMeta, OUT_OF_MEMORY, prepare, type MockupSet, type Placement, type SetMeta } from "./layers"
import { crc32 } from "./zip"

export type Job = {
  id: number
  kind: "bitmap" | "png" | "webp"
  lane: string
  gen: number
  /** lower runs first */
  prio: number
  set: MockupSet
  colour: string
  size: number
  shot: number
  /** design width on the print template, px (capped at the source's native resolution here) */
  width: number
  placement: Placement
  /** bitmap and webp: final width (square layers); shrunk with downscale() when smaller than the layer size */
  out?: number
  /** png: flattened on white (default) or kept transparent */
  background?: "white" | "transparent"
  /** webp: 50-100 */
  quality?: number
}

/** size: the layer size actually used (2400 falls back to 1200 when it is not uploaded). */
export type WorkerResult = { id: number; size?: number; bitmap?: ImageBitmap; blob?: Blob; crc?: number; mime?: string; skipped?: true; error?: string }

export type WorkerMessage =
  | { type: "config"; layerBytes: number; designBytes: number }
  | { type: "image"; bitmap: ImageBitmap }
  | { type: "job"; job: Job }
  | { type: "bump"; lane: string; gen: number }

const ctx = self as any
let source: ImageBitmap | null = null
let designBytes = 160e6
const designs = new Map<string, { design: PreparedDesign; bytes: number }>()
const latest = new Map<string, number>()
const queue: Job[] = []
// base|colour whose 2400 px layers are not uploaded (a colour's sizes are uploaded together): later jobs go straight to 1200
const missing = new Set<string>()
let running = false
// null until the first shop image answers: Safari's convertToBlob answers image/webp with a PNG
let webpOK: boolean | null = null

type Inputs = { meta: SetMeta; layers: ShotLayers; size: number; wanted: number }
// A job's meta and layer download, started when the job heads the queue. The promise holds the layers itself, so a
// cache eviction cannot undo a finished download.
const io = new Map<number, Promise<Inputs>>()
const settled = new Set<number>()

// One macrotask on a private channel: messages already waiting (bumps, newer jobs) are handled first.
// Unlike chained setTimeout(0) it is never clamped to 4 ms.
const yielder = new MessageChannel()
const resumes: (() => void)[] = []
yielder.port1.onmessage = () => resumes.shift()?.()
const handleWaiting = () => new Promise<void>((resolve) => { resumes.push(resolve); yielder.port2.postMessage(0) })
const stale = (job: Job) => job.gen < (latest.get(job.lane) ?? 0)

const post = (result: WorkerResult, transfer: Transferable[] = []) => ctx.postMessage(result, transfer)

// Oldest first, never the one just made; room is made before a new design is allocated.
function trimDesigns(extra: number, keep: string | null) {
  let total = extra
  for (const e of designs.values()) total += e.bytes
  for (const [key, e] of designs) {
    if (total <= designBytes) break
    if (key === keep) continue
    designs.delete(key)
    total -= e.bytes
  }
}

function designFor(meta: ShotMeta, wanted: number, p: Placement) {
  const src = source!
  const A = meta.template_mm[1] / meta.template_mm[0]
  // more template pixels than the source has across the print add no detail
  const cap = Math.max(640, Math.ceil(Math.min(src.width, src.height / A) / p.zoom))
  const width = Math.min(Math.round(wanted), cap)
  const key = `${A}|${width}|${p.zoom}|${p.ox}|${p.oy}`
  const hit = designs.get(key)
  if (hit) { designs.delete(key); designs.set(key, hit); return hit.design }
  const bytes = width * Math.round(width * A) * 3 * 1.34
  trimDesigns(bytes, null)
  const design = prepare(src, meta, width, p)
  designs.set(key, { design, bytes })
  return design
}

// A layer that is not there: 404, or a blocked read (an R2 error page may come without the CORS header).
const notUploaded = (error: any) => /\(404\)|could not read the layer files/.test(String(error?.message ?? error))

function release(...canvases: OffscreenCanvas[]) {
  for (const c of canvases) c.width = c.height = 0
}

function onWhite(canvas: OffscreenCanvas) {
  const flat = new OffscreenCanvas(canvas.width, canvas.height)
  const g = context2d(flat)
  g.fillStyle = "#fff"
  g.fillRect(0, 0, flat.width, flat.height)
  g.drawImage(canvas, 0, 0)
  return flat
}

// The network part of a job: its meta and layers, with the 2400 -> 1200 fallback.
async function fetchInputs(job: Job): Promise<Inputs> {
  const base = job.set.base_url
  const meta = await loadMeta(base, job.colour)
  const miss = `${base}|${job.colour}`
  let size = job.size, wanted = job.width
  if (size > 1200 && missing.has(miss)) { size = 1200; wanted = Math.min(wanted, 3072) }
  try {
    return { meta, layers: await loadLayers(base, job.colour, size, job.shot), size, wanted }
  } catch (error) {
    if (size <= 1200 || !notUploaded(error)) throw error
    missing.add(miss)
    size = 1200; wanted = Math.min(wanted, 3072)
    return { meta, layers: await loadLayers(base, job.colour, size, job.shot), size, wanted }
  }
}

// The CPU part: design prep, composite and encoding.
async function render(job: Job, inputs: Inputs): Promise<Omit<WorkerResult, "id">> {
  if (!source) throw new Error("Choose a design first.") // pump holds jobs until a design arrives
  const { meta, layers, size, wanted } = inputs
  // full-size work (stage Full, lightbox, PNGs, ZIP, supersampled shop images) can be dropped part-way
  const heavy = size > 1200 || wanted > 2048
  if (stale(job)) return { skipped: true }
  const design = designFor(meta, wanted, job.placement)
  // a newer job in this lane came in during a long design prep (4096 px: ~2.6 s): skip the composite,
  // the prepared design stays cached for it
  if (heavy) { await handleWaiting(); if (stale(job)) return { skipped: true } }
  const { w, h } = layers
  const rgba = composite(layers, meta, design)
  const canvas = new OffscreenCanvas(w, h)
  context2d(canvas).putImageData(new ImageData(rgba as unknown as ImageData["data"], w, h), 0, 0)
  const outW = job.out && job.out < w ? Math.round(job.out) : 0
  const outH = outW ? Math.max(1, Math.round((outW * h) / w)) : 0

  if (job.kind === "bitmap") {
    let c = canvas
    if (outW) { c = downscale(canvas, outW, outH); release(canvas) }
    const bitmap = c.transferToImageBitmap()
    release(c)
    return { size, bitmap }
  }
  if (job.kind === "png") {
    const c = job.background === "transparent" ? canvas : onWhite(canvas)
    const blob = await c.convertToBlob({ type: "image/png" })
    release(canvas, c)
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()))
    return { size, blob, crc, mime: blob.type }
  }
  // webp: the shop's images, flattened on white; JPEG where the browser cannot encode WebP (Safari)
  let c = onWhite(canvas)
  release(canvas)
  if (outW) { const small = downscale(c, outW, outH); release(c); c = small }
  const q = Math.min(Math.max(job.quality ?? 92, 50), 100) / 100
  let blob: Blob | null = null
  if (webpOK !== false) {
    blob = await c.convertToBlob({ type: "image/webp", quality: q })
    webpOK = blob.type === "image/webp"
  }
  if (!webpOK) blob = await c.convertToBlob({ type: "image/jpeg", quality: q })
  release(c)
  return { size, blob: blob!, mime: blob!.type }
}

function drop(id: number) {
  io.delete(id)
  settled.delete(id)
}

function start(job: Job) {
  if (io.has(job.id)) return
  const p = fetchInputs(job)
  io.set(job.id, p)
  // success or error: the job can run now (an error is posted when it runs; errors are not cached, so nothing loops)
  p.then(() => undefined, () => undefined).then(() => {
    if (io.get(job.id) !== p) return // dropped meanwhile
    settled.add(job.id)
    void pump()
  })
}

// Jobs older than their lane's newest generation answer "skipped" at once instead of waiting their turn.
function purge(lane: string) {
  const gen = latest.get(lane) ?? 0
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].lane !== lane || queue[i].gen >= gen) continue
    const id = queue.splice(i, 1)[0].id
    drop(id) // a download still running finishes anyway and only warms the cache
    post({ id, skipped: true })
  }
}

async function pump() {
  if (running) return
  running = true
  while (queue.length) {
    await handleWaiting() // bumps and newer jobs that arrived during the last render go first
    // no design yet (a fresh worker after a crash): keep the queue, the image message starts pump again
    if (!queue.length || !source) break
    const order = queue.map((_, i) => i).sort((a, b) => queue[a].prio - queue[b].prio || a - b)
    const head = queue[order[0]]
    if (stale(head)) { queue.splice(order[0], 1); drop(head.id); post({ id: head.id, skipped: true }); continue }
    start(head) // only the head's download: memory stays bounded
    const k = order.find((i) => settled.has(queue[i].id))
    if (k === undefined) break // the worker is free while it downloads; the settled download or a new job calls pump()
    const job = queue.splice(k, 1)[0]
    const inputs = io.get(job.id)!
    drop(job.id)
    try {
      const result = await render(job, await inputs)
      post({ id: job.id, ...result }, result.bitmap ? [result.bitmap] : [])
    } catch (error: any) {
      const message = String(error?.message ?? error)
      post({ id: job.id, error: error instanceof RangeError || /out of memory|allocation failed/i.test(message) ? OUT_OF_MEMORY : message })
    }
  }
  running = false
}

ctx.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const m = e.data
  if (m.type === "config") {
    configureLayerCache(m.layerBytes)
    designBytes = m.designBytes
    trimDesigns(0, null)
  } else if (m.type === "image") {
    source?.close()
    source = m.bitmap
    designs.clear()
    void pump() // jobs held for a design
  } else if (m.type === "bump") {
    latest.set(m.lane, Math.max(latest.get(m.lane) ?? 0, m.gen))
    purge(m.lane)
  } else if (m.type === "job") {
    latest.set(m.job.lane, Math.max(latest.get(m.job.lane) ?? 0, m.job.gen))
    purge(m.job.lane)
    queue.push(m.job)
    void pump()
  }
}
