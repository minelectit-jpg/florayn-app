// Promise wrapper around one mockup worker.
import type { Job } from "./worker"

type Result = { rgba?: ArrayBuffer; w?: number; h?: number; blob?: Blob; skipped?: boolean; error?: string }
export type JobInput = Omit<Job, "id" | "kind" | "gen">

export class Renderer {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  private seq = 0
  private gens = new Map<string, number>()
  private pending = new Map<number, (r: Result) => void>()

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Result & { id: number }>) => {
      const done = this.pending.get(e.data.id)
      this.pending.delete(e.data.id)
      done?.(e.data)
    }
  }

  /** The worker keeps its own copy of the design image. */
  async setImage(file: Blob) {
    const bitmap = await createImageBitmap(file)
    this.worker.postMessage({ type: "image", bitmap }, [bitmap])
  }

  /** Starts a new generation for a lane: older queued jobs of that lane are dropped. */
  bump(lane: string) {
    const gen = (this.gens.get(lane) ?? 0) + 1
    this.gens.set(lane, gen)
    return gen
  }

  private send(kind: Job["kind"], input: JobInput, gen: number): Promise<Result> {
    const id = ++this.seq
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage({ type: "job", job: { ...input, id, kind, gen } })
    })
  }

  /** ImageData, or null when a newer job in the same lane replaced it. */
  async render(input: JobInput, gen: number): Promise<ImageData | null> {
    const r = await this.send("render", input, gen)
    if (r.error) throw new Error(r.error)
    if (r.skipped || !r.rgba) return null
    return new ImageData(new Uint8ClampedArray(r.rgba), r.w!, r.h!)
  }

  async webp(input: JobInput, gen: number): Promise<Blob> {
    const r = await this.send("webp", input, gen)
    if (r.error) throw new Error(r.error)
    if (!r.blob) throw new Error("The image was not made.")
    return r.blob
  }

  dispose() { this.worker.terminate() }
}
