// Mockup Studio > New product: ZIP downloads and publishing (MOCKUP_STUDIO.md).
// Publishing takes the same server path as before: POST /admin/designs/upload per
// picture, then POST /admin/designs/custom. Only the shop images are compressed.
import { ApiError, post } from "../../../api"
import type { Renderer } from "../../../mockup/client"
import { blobToBase64, designWidthFor, loadMeta, pickSize, shotLabel, type MockupSet, type Placement, type SetMeta, type Settings } from "../../../mockup/layers"
import { makeZip, saveBlob, type ZipEntry } from "../../../mockup/zip"
import { toast } from "../../../ui"
import { cellKey } from "./engine"
import { etaText, NEW_COLLECTION, type Details } from "./state"

export type JobState = { kind: "publish" | "zip"; phase: "checking" | "making" | "creating" | "zipping"; done: number; total: number; label: string; eta: string }

const mb = (bytes: number) => (bytes / 1e6).toFixed(1)

// --- ZIP -------------------------------------------------------------------------------------------------
/** full: whether the colour's 2400 px layers are uploaded (false: made at 1200 straight away). */
export type ZipItem = { set: MockupSet; colour: string; shot: number; shotName: string; model: string; full?: boolean | null; entry: (size: number) => string }

/** Makes every picture as a lossless PNG (2400 px, 1200 where 2400 is not uploaded) and saves them as one ZIP. */
export async function downloadShots(o: {
  items: ZipItem[]; zipName: string; ex: Renderer; hq: number; placement: Placement; background: "white" | "transparent"
  signal: AbortSignal; onJob: (job: JobState) => void
  /** the page's design epoch: when it moves, the renderer may hold another design (low-memory devices share it) */
  epoch: { current: number }
  /** each PNG made (its size and bytes), for the download estimate */
  onPng?: (size: number, bytes: number) => void
}) {
  const { items, ex, signal } = o
  const total = items.length
  const entries: ZipEntry[] = []
  const errors: string[] = []
  const fallbacks = new Map<string, number>()
  let done = 0, eta = ""
  const t0 = performance.now()
  const gen = ex.bump("zip")
  const ep = o.epoch.current
  // outside the per-picture try: nothing is saved with pictures of another design in it
  const same = () => { if (o.epoch.current !== ep) throw new Error("The design changed while the pictures were made. Try again.") }
  for (const it of items) {
    if (signal.aborted) break
    same()
    o.onJob({ kind: "zip", phase: "making", done, total, label: `Making ${it.model} · ${it.shot}. ${shotLabel(it.shotName)}`, eta })
    try {
      const big = it.full !== false
      const r = await ex.png({
        set: it.set, colour: it.colour, shot: it.shot, size: big ? 2400 : 1200, width: big ? o.hq : Math.min(o.hq, 3072),
        placement: o.placement, background: o.background, lane: "zip", prio: 1,
      }, gen)
      entries.push({ name: it.entry(r.size), blob: r.blob, crc: r.crc })
      o.onPng?.(r.size, r.blob.size)
      if (r.size < 2400) fallbacks.set(`${it.model} ${it.colour}`, (fallbacks.get(`${it.model} ${it.colour}`) ?? 0) + 1)
    } catch (error: any) {
      if (signal.aborted || error?.name === "AbortError") break
      errors.push(String(error?.message ?? error))
    }
    done++
    if (done >= 2) eta = etaText((performance.now() - t0) / done, total - done)
  }
  if (signal.aborted) { toast("Download cancelled."); return }
  same()
  if (!entries.length) { toast(`Nothing was saved: ${errors[0] ?? "no pictures were made."}`, "error"); return }
  o.onJob({ kind: "zip", phase: "zipping", done, total, label: "Packing the ZIP…", eta: "" })
  const zip = makeZip(entries)
  saveBlob(zip, o.zipName)
  let message = errors.length ? `Saved ${entries.length} of ${total}. ${errors.length} could not be made: ${errors[0]}` : `Saved ${o.zipName} (${mb(zip.size)} MB).`
  for (const [what, k] of fallbacks) message += ` ${k} pictures are 1200 px: 2400 px isn't uploaded for ${what} yet.`
  toast(message, errors.length ? "info" : "success")
}

// --- publish ---------------------------------------------------------------------------------------------
export class Stopped extends Error { constructor() { super("Stopped."); this.name = "Stopped" } }
export class Taken extends Error { constructor(message: string) { super(message); this.name = "Taken" } }

/** full: whether the colour's 2400 px layers are uploaded (false: shop images are made from 1200). */
export type PublishModel = { set: MockupSet; colour: string; model: string; full?: boolean | null }

/**
 * Makes the gallery shots of every chosen model as shop images and creates the product. The next picture is made
 * while the current one uploads. Throws Stopped, Taken or an Error. Nothing is created unless it returns, except that
 * a /admin/designs/custom call that got no answer (timeout, dropped connection, gateway error) may still have created
 * it: that error carries maybeCreated.
 */
export async function publishProduct(o: {
  settings: Settings; models: PublishModel[]; details: Details; placement: Placement; version: number
  hq: number; lowMemory: boolean; exporter: () => Promise<Renderer>
  stopped: () => boolean; onJob: (job: JobState) => void; onUploaded: (cell: string) => void; onMilestone: (pct: number) => void
}): Promise<{ slug: string; perModel: number }> {
  const { settings, details } = o
  const slug = details.slug
  let job: JobState = { kind: "publish", phase: "checking", done: 0, total: 0, label: "Checking the URL…", eta: "" }
  const set = (patch: Partial<JobState>) => { job = { ...job, ...patch }; o.onJob(job) }
  o.onJob(job)

  const check = await fetch(`/admin/designs/${encodeURIComponent(slug)}`, { credentials: "include" })
  if (check.ok) throw new Taken(`The URL "${slug}" is already used by another design. Change it in Details.`)
  if (check.status !== 404) throw new Error(`Couldn't check the URL (${check.status}). Try again.`)

  const plan: (PublishModel & { meta: SetMeta; shots: number[] })[] = []
  for (const m of o.models) {
    const meta = await loadMeta(m.set.base_url, m.colour)
    const shots = settings.shots.filter((n) => meta.shots.some((x) => x.n === n))
    if (!shots.length) throw new Error(`${m.model} has none of the gallery shots.`)
    plan.push({ ...m, meta, shots })
  }
  if (o.stopped()) throw new Stopped()
  const total = plan.reduce((sum, p) => sum + p.shots.length, 0)
  set({ phase: "making", total, label: "Starting…" })

  const ex = await o.exporter()
  if (o.stopped()) throw new Stopped()
  const gen = ex.bump("publish")
  // sharper shop images: made from the 2400 px renders, then shrunk
  const superOK = settings.supersample && settings.image_size <= 1200 && !o.lowMemory
  const make = (p: (typeof plan)[number], n: number) => {
    const big = superOK && p.full !== false && p.meta.sizes.includes(2400)
    const size = big ? 2400 : pickSize(p.meta.sizes, settings.image_size)
    return ex.webp({
      set: p.set, colour: p.colour, shot: n, placement: o.placement, lane: "publish", prio: 1, quality: settings.quality,
      size, width: big ? o.hq : designWidthFor(size, o.hq), out: superOK ? settings.image_size : undefined,
    }, gen)
  }

  const pairs: Record<string, string[]> = {}
  const t0 = performance.now()
  let done = 0, milestone = 0
  for (const p of plan) {
    const urls: string[] = []
    const k = p.shots.length
    let next: ReturnType<typeof make> | null = make(p, p.shots[0])
    try {
      for (let i = 0; i < k; i++) {
        if (o.stopped()) throw new Stopped()
        set({ label: `Making ${p.model} · picture ${i + 1} of ${k}` })
        const { blob, mime } = await next!
        if (o.stopped()) throw new Stopped()
        next = i + 1 < k ? make(p, p.shots[i + 1]) : null
        next?.catch(() => undefined) // a failure is reported when it is awaited; it must not go unhandled during the upload
        set({ label: `Uploading ${p.model} · picture ${i + 1} of ${k}` })
        const body = {
          designSlug: slug, caseTypeSlug: settings.case_type, deviceSlug: p.set.device, index: i + 1,
          filename: `${i + 1}.${mime === "image/jpeg" ? "jpg" : "webp"}`, mimeType: mime, contentBase64: await blobToBase64(blob),
        }
        // one retry: a fresh upload key every time, so a retry never collides
        const uploaded = await post<{ url: string }>("/admin/designs/upload", body).catch(() => post<{ url: string }>("/admin/designs/upload", body))
        urls.push(uploaded.url)
        o.onUploaded(cellKey(p.set.device, p.colour, p.shots[i], o.version))
        done++
        const pct = Math.floor((done / total) * 4) * 25
        if (pct > milestone && pct < 100) { milestone = pct; o.onMilestone(pct) }
        set({ done, eta: done >= 2 ? etaText((performance.now() - t0) / done, total - done) : "" })
      }
    } finally {
      // a picture still being made when this stops is not needed any more
      next?.catch(() => undefined)
    }
    pairs[p.set.device] = urls
  }

  // the last point where stopping leaves no product
  if (o.stopped()) throw new Stopped()
  set({ phase: "creating", label: details.status === "draft" ? "Creating the draft…" : "Publishing…", eta: "" })
  const theme = details.collection === NEW_COLLECTION ? details.newCollection.trim() : details.collection
  let result: any
  try {
    result = await post("/admin/designs/custom", {
      name: details.name.trim(), slug, description: details.description, theme: theme || null, status: details.status,
      blankStock: Number(details.stock), pairs: { [settings.case_type]: pairs },
    })
  } catch (error: any) {
    // no answer (timeout, dropped connection) or a gateway error: the server may still have created it
    if (error && typeof error === "object" && (!(error instanceof ApiError) || error.status >= 500)) error.maybeCreated = true
    throw error
  }
  return { slug: result.result?.design ?? slug, perModel: plan[0]?.shots.length ?? 0 }
}
