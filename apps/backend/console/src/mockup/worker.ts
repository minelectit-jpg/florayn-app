// Renders mockup shots off the main thread (MOCKUP_STUDIO.md). One job at a time;
// a job older than the newest one in its lane is dropped, so dragging a slider
// never queues up stale renders.
import type { PreparedDesign } from "./compositor"
import { composite } from "./compositor"
import { loadLayers, loadMeta, prepare, toWebp, type MockupSet, type Placement } from "./layers"

export type Job = {
  id: number
  kind: "render" | "webp"
  lane: string
  gen: number
  set: MockupSet
  colour: string
  size: number
  shot: number
  /** design width on the print template, px */
  width: number
  placement: Placement
  quality?: number
}

const ctx = self as any
let source: ImageBitmap | null = null
const designs = new Map<string, PreparedDesign>()
const latest = new Map<string, number>()
const queue: Job[] = []
let running = false

async function design(job: Job) {
  const meta = await loadMeta(job.set.base_url, job.colour)
  const width = Math.min(job.width, Math.max(source!.width, source!.height))
  const p = job.placement
  const key = `${meta.template_mm.join("x")}|${width}|${p.zoom}|${p.ox}|${p.oy}`
  let d = designs.get(key)
  if (!d) {
    d = prepare(source!, meta, width, p)
    designs.set(key, d)
    // full-size designs are tens of MB each; keep only the latest few
    while (designs.size > 3) designs.delete(designs.keys().next().value!)
  }
  return { meta, design: d }
}

async function run(job: Job) {
  if (!source) throw new Error("Choose a design first.")
  const [{ meta, design: d }, layers] = await Promise.all([design(job), loadLayers(job.set.base_url, job.colour, job.size, job.shot)])
  const image = new ImageData(layers.w, layers.h)
  image.data.set(composite(layers, meta, d))
  if (job.kind === "webp") return { blob: await toWebp(image, job.quality ?? 85) }
  return { rgba: image.data.buffer, w: image.width, h: image.height }
}

async function pump() {
  if (running) return
  running = true
  while (queue.length) {
    const job = queue.shift()!
    if (job.gen < (latest.get(job.lane) ?? 0)) { ctx.postMessage({ id: job.id, skipped: true }); continue }
    try {
      const result = await run(job)
      ctx.postMessage({ id: job.id, ...result }, "rgba" in result ? [result.rgba] : [])
    } catch (error: any) {
      ctx.postMessage({ id: job.id, error: String(error?.message ?? error) })
    }
  }
  running = false
}

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m.type === "image") {
    source?.close()
    source = m.bitmap
    designs.clear()
  } else if (m.type === "job") {
    latest.set(m.job.lane, Math.max(latest.get(m.job.lane) ?? 0, m.job.gen))
    queue.push(m.job)
    void pump()
  }
}
