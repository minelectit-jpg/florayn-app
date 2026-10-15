// Promise wrapper around one mockup worker (MOCKUP_STUDIO.md). If the worker dies
// (on phones nearly always memory), every job it was working on fails with
// OUT_OF_MEMORY and a fresh worker takes over with the same settings and design;
// jobs sent meanwhile wait in it for the design and finish there.
import { A_DEFAULT, downscale, MAX_CANVAS_PX, OUT_OF_MEMORY } from "./layers"
import type { Job, WorkerMessage, WorkerResult } from "./worker"

export type RendererOptions = {
  /** decoded layer cache, bytes */
  layerBytes: number
  /** prepared design cache, bytes */
  designBytes: number
  /** the design is shrunk on the way in when more pixels than this lie across the print */
  maxAcross: number
  /** ... and when it has more pixels than this in all (iOS refuses canvases over 16.7 MP) */
  maxPixels: number
}
/** A job without the parts the renderer fills in; prio defaults to 0 (runs first). */
export type JobInput = Omit<Job, "id" | "kind" | "gen" | "prio"> & { prio?: number }

/**
 * Budgets per worker. The export worker is not made on low-memory devices (they reuse detail). The quick worker holds
 * one model's 13 shots at 600 px (13 x 4.7 MB) everywhere, so the filmstrip never reloads them. The export worker
 * uses every shot once per job, so it keeps only the one being made (one 2400 shot is 75 MB).
 */
export function rendererOptions(kind: "quick" | "detail" | "export", lowMemory: boolean): RendererOptions {
  const maxPixels = lowMemory ? MAX_CANVAS_PX : Infinity
  if (kind === "quick") return { layerBytes: 64e6, designBytes: 32e6, maxAcross: 2560, maxPixels }
  if (kind === "detail") return lowMemory ? { layerBytes: 120e6, designBytes: 80e6, maxAcross: 3072, maxPixels } : { layerBytes: 280e6, designBytes: 160e6, maxAcross: 6144, maxPixels }
  return { layerBytes: 80e6, designBytes: 160e6, maxAcross: 6144, maxPixels: Infinity }
}

/** How much a w x h design is shrunk on its way into a worker (1: not at all). */
export const designScale = (w: number, h: number, o: RendererOptions) =>
  Math.min(1, o.maxAcross / Math.min(w, h / A_DEFAULT), Math.sqrt(o.maxPixels / (w * h)))

/** The error a png() or webp() job gets when a newer generation of its lane replaced it (name "AbortError"). */
function replaced() {
  const error = new Error("Cancelled.")
  error.name = "AbortError"
  return error
}

type Pending = { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }

export class Renderer {
  private opts: RendererOptions
  private worker: Worker
  private seq = 0
  private gens = new Map<string, number>()
  private pending = new Map<number, Pending>()
  private lastFile: Blob | null = null
  private imageSeq = 0
  /** the current worker has been sent a design */
  private hasImage = false
  /** the current worker has no design and the last attempt to send one failed */
  private imageError: Error | null = null
  private crashes: number[] = []
  private broken = false
  private disposed = false

  constructor(opts: RendererOptions) {
    this.opts = opts
    this.worker = this.spawn()
  }

  private spawn() {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      this.crashes = []
      p.resolve(e.data)
    }
    worker.onerror = (e) => { e.preventDefault(); this.crash(worker) }
    worker.onmessageerror = () => this.crash(worker)
    const config: WorkerMessage = { type: "config", layerBytes: this.opts.layerBytes, designBytes: this.opts.designBytes }
    worker.postMessage(config)
    return worker
  }

  private failPending(error: Error) {
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const p of waiting) p.reject(error)
  }

  private crash(from: Worker) {
    if (from !== this.worker) return
    from.terminate()
    this.failPending(new Error(OUT_OF_MEMORY))
    if (this.disposed) return
    // a worker that cannot even start would crash forever: stop after 4 deaths in 10 s without one result
    const now = Date.now()
    this.crashes = this.crashes.filter((t) => now - t < 10_000).concat(now)
    if (this.crashes.length > 3) { this.broken = true; return }
    this.worker = this.spawn()
    this.hasImage = false
    this.imageError = null
    // jobs sent from now on wait in the new worker for this design; if it cannot be sent, setImage fails them
    if (this.lastFile) this.setImage(this.lastFile).catch(() => undefined)
  }

  private post(message: WorkerMessage, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer)
  }

  /**
   * The worker keeps its own copy of the design. decoded (optional) is an already decoded bitmap of the file, and it
   * stays the caller's: it is read directly when the design must shrink, and copied only when it is sent at full size.
   * Designs with more than maxAcross pixels across the print, or more than maxPixels in all, are shrunk.
   */
  async setImage(file: Blob, decoded?: ImageBitmap): Promise<void> {
    this.lastFile = file
    const seq = ++this.imageSeq
    let bitmap: ImageBitmap
    try {
      const own = decoded ? null : await createImageBitmap(file)
      const src = (decoded ?? own)!
      const k = designScale(src.width, src.height, this.opts)
      if (k < 1) {
        // shrink straight from the source (drawImage only reads it): never a full-size copy of a design about to shrink
        let small: OffscreenCanvas
        try { small = downscale(src, src.width * k, src.height * k, this.opts.maxPixels) } finally { own?.close() }
        bitmap = small.transferToImageBitmap()
        small.width = small.height = 0
      } else {
        // the worker needs its own copy; the file's own decode is sent without one
        bitmap = own ?? await createImageBitmap(src)
      }
    } catch (error: any) {
      // only the newest attempt counts, and a worker that still holds an older design keeps rendering with it
      if (seq === this.imageSeq && !this.hasImage && !this.disposed) {
        this.imageError = error instanceof Error ? error : new Error(String(error))
        this.failPending(this.imageError)
      }
      throw error
    }
    if (seq !== this.imageSeq || this.disposed) { bitmap.close(); return } // a newer design won
    this.post({ type: "image", bitmap }, [bitmap])
    this.hasImage = true
    this.imageError = null
  }

  /** Starts a new generation for a lane: older jobs of that lane still waiting are dropped. */
  bump(lane: string): number {
    const gen = (this.gens.get(lane) ?? 0) + 1
    this.gens.set(lane, gen)
    if (!this.disposed && !this.broken) this.post({ type: "bump", lane, gen })
    return gen
  }

  private send(kind: Job["kind"], input: JobInput, gen: number): Promise<WorkerResult> {
    if (this.disposed) return Promise.reject(replaced())
    if (this.broken) return Promise.reject(new Error(OUT_OF_MEMORY))
    if (this.imageError) return Promise.reject(this.imageError)
    // the worker holds jobs until it has a design: never send one that no design will ever release
    if (!this.lastFile) return Promise.reject(new Error("Choose a design first."))
    const id = ++this.seq
    if (gen < (this.gens.get(input.lane) ?? 0)) return Promise.resolve({ id, skipped: true })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post({ type: "job", job: { ...input, prio: input.prio ?? 0, id, kind, gen } })
    })
  }

  /** The shot as an ImageBitmap (out wide when out is smaller than the layers), or null when a newer job in its lane replaced it. */
  async bitmap(input: JobInput, gen: number): Promise<{ bitmap: ImageBitmap; size: number } | null> {
    const r = await this.send("bitmap", input, gen)
    if (r.error) throw new Error(r.error)
    if (r.skipped || !r.bitmap) return null
    return { bitmap: r.bitmap, size: r.size ?? input.size }
  }

  /** Lossless PNG at the layer size, on white or transparent, with its CRC-32 for makeZip. */
  async png(input: JobInput, gen: number): Promise<{ blob: Blob; crc: number; size: number }> {
    const r = await this.send("png", input, gen)
    if (r.error) throw new Error(r.error)
    if (r.skipped) throw replaced()
    if (!r.blob || r.crc === undefined) throw new Error("The picture was not made.")
    return { blob: r.blob, crc: r.crc, size: r.size ?? input.size }
  }

  /** Shop image on white: WebP, or JPEG where the browser cannot encode WebP (mime says which). */
  async webp(input: JobInput, gen: number): Promise<{ blob: Blob; mime: string; size: number }> {
    const r = await this.send("webp", input, gen)
    if (r.error) throw new Error(r.error)
    if (r.skipped) throw replaced()
    if (!r.blob) throw new Error("The image was not made.")
    return { blob: r.blob, mime: r.mime ?? r.blob.type, size: r.size ?? input.size }
  }

  /** Stops the worker; jobs still waiting fail with an AbortError. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.worker.terminate()
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const p of waiting) p.reject(replaced())
  }
}
