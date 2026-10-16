// Mockup Studio > New product: ZIP downloads and publishing (MOCKUP_STUDIO.md).
// Publishing takes the Product Manager's server path: POST /admin/designs/upload per
// picture, then POST /admin/designs/custom (a new product) or manager-variants and
// /pairs (Update pictures), then one POST /admin/designs/:slug/colours per model
// (PHONE_COLOURS.md). Only the shop images are compressed.
import { ApiError, post } from "../../../api"
import type { Renderer } from "../../../mockup/client"
import { blobToBase64, designWidthFor, loadMeta, pickSize, shotLabel, type MockupSet, type Placement, type SetMeta, type Settings } from "../../../mockup/layers"
import { makeZip, saveBlob, type ZipEntry } from "../../../mockup/zip"
import { toast } from "../../../ui"
import { cellKey } from "./engine"
import { anglesOf, entryName, etaText, NEW_COLLECTION, plural, sharedShots, zipFolder, type Details } from "./state"

export type JobState = {
  kind: "publish" | "zip"
  /** colours: a new product's phone colour calls; saving: Update pictures' Product Manager calls */
  phase: "checking" | "making" | "creating" | "colours" | "saving" | "zipping"
  done: number; total: number; label: string; eta: string
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1)

// --- ZIP -------------------------------------------------------------------------------------------------
/** full: whether the colour's 2400 px layers are uploaded (false: made at 1200 straight away). */
export type ZipItem = { set: MockupSet; colour: string; shot: number; shotName: string; model: string; full?: boolean | null; entry: (size: number) => string }
export type ZipModel = { set: MockupSet; model: string; colours: { name: string; meta: SetMeta; full?: boolean | null }[] }

/**
 * Every picture of a ZIP: each colour's meta shots, gallery ones first. A one-model ZIP in one colour is flat
 * (single: true); otherwise every colour of every model gets its own <device>_<colour>/ folder.
 */
export function zipItems(models: ZipModel[], gallery: number[], single = false): ZipItem[] {
  const flat = single && models.length === 1 && models[0].colours.length === 1
  const items: ZipItem[] = []
  for (const m of models) {
    for (const c of m.colours) {
      for (const n of anglesOf(c.meta, gallery)) {
        const shotName = c.meta.shots.find((x) => x.n === n)?.name ?? String(n)
        items.push({ set: m.set, colour: c.name, shot: n, shotName, model: m.model, full: c.full, entry: (size) => (flat ? "" : zipFolder(m.set.device, c.name)) + entryName(n, shotName, size) })
      }
    }
  }
  return items
}

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
    o.onJob({ kind: "zip", phase: "making", done, total, label: `Making ${it.model} · ${it.colour} · ${it.shot}. ${shotLabel(it.shotName)}`, eta })
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

/** One ticked phone colour. slug: its web name; main: what the variant's own gallery shows; full: 2400 px uploaded. */
export type PublishColour = { name: string; slug: string; main: boolean; full?: boolean | null }
/** colours: main first, then palette order. */
export type PublishModel = { set: MockupSet; model: string; colours: PublishColour[] }

/** The parts of GET /admin/designs/:slug that Update pictures reads. */
export type ExistingDesign = {
  slug: string; name: string; kind: "design" | "regular"; collection: { id: string; title: string } | null
  products: {
    id: string; form: string; status: string; description: string
    variants: { id: string; caseTypeSlug: string | null; deviceSlug: string | null; phoneColours?: { main: string | null; extra: Record<string, string[]> } }[]
  }[]
}

/**
 * One idempotent Product Manager request after the uploads. done: the server confirmed it. independent: one model's
 * colours; if the server refuses it, the steps after it still run.
 */
export type ServerStep = { label: string; doing: string; path: string; body: unknown; done: boolean; independent?: boolean }
/** stopped: Stop was pressed before label's step; otherwise that step failed with message. */
export type StepFailure = { label: string; message: string; stopped: boolean }
export type PublishResult = {
  slug: string
  /** pictures per colour of the first model */
  perModel: number
  pictures: number
  /** the requests after the uploads (a new product: one colours call per model; Update pictures: all of them) */
  steps: ServerStep[]
  failure: StepFailure | null
}

/** Batches of at most n, so every request stays well under the 100 KB body limit. */
function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}
export const STEP_BATCH = 20

type Urls = Record<string, Record<string, string[]>>
const mainOf = (m: PublishModel) => m.colours.find((c) => c.main) ?? m.colours[0]

/** The /colours call of one model: its main colour marker and every other colour's pictures, replacing older ones. */
export function colourSteps(slug: string, caseType: string, models: PublishModel[], urls: Urls): ServerStep[] {
  return models.map((m, i) => {
    const main = mainOf(m), mine = urls[m.set.device] ?? {}
    const galleries = Object.fromEntries(m.colours.filter((c) => c !== main).map((c) => [c.slug, mine[c.slug] ?? []]))
    return {
      label: `the phone colours of ${m.model}`, doing: `Saving phone colours ${i + 1} of ${models.length}…`,
      path: `/admin/designs/${encodeURIComponent(slug)}/colours`,
      body: { source: "mockup_studio", variants: [{ caseType, device: m.set.device, main: main.slug, galleries, replace: true }] },
      done: false, independent: true,
    }
  })
}

/** The case type variant of a model in an existing design, with its product. */
export function existingVariant(d: ExistingDesign, caseType: string, device: string) {
  for (const p of d.products) for (const v of p.variants) if (v.caseTypeSlug === caseType && v.deviceSlug === device) return { productId: p.id, variantId: v.id }
  return null
}

/**
 * Update pictures (never /custom, never delete and recreate): the main pictures of the models the design has, through
 * manager-variants (keeps every ID, rebuilds product.images, the cover and the cards); the missing models through
 * /pairs (reuses the shared blank, never resets stock); then the colours calls, replacing older colour pictures.
 */
export function updateSteps(d: ExistingDesign, caseType: string, models: PublishModel[], urls: Urls): ServerStep[] {
  const byProduct = new Map<string, { m: PublishModel; id: string }[]>()
  const missing: PublishModel[] = []
  for (const m of models) {
    const v = existingVariant(d, caseType, m.set.device)
    if (v) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), { m, id: v.variantId }])
    else missing.push(m)
  }
  const mainUrls = (m: PublishModel) => urls[m.set.device]?.[mainOf(m).slug] ?? []
  const steps: ServerStep[] = []
  const batches = [...byProduct].flatMap(([productId, list]) => chunks(list, STEP_BATCH).map((part) => ({ productId, part })))
  batches.forEach(({ productId, part }, i) => steps.push({
    label: `the main pictures of ${plural(part.length, "model")}`, doing: `Replacing the main pictures${batches.length > 1 ? ` (${i + 1} of ${batches.length})` : ""}…`,
    path: `/admin/products/${encodeURIComponent(productId)}/manager-variants`,
    body: { variants: part.map(({ m, id }) => ({ id, images: mainUrls(m) })) }, done: false,
  }))
  const adds = chunks(missing, STEP_BATCH)
  adds.forEach((part, i) => steps.push({
    label: plural(part.length, "new model"), doing: `Adding ${plural(part.length, "new model")}${adds.length > 1 ? ` (${i + 1} of ${adds.length})` : ""}…`,
    path: `/admin/designs/${encodeURIComponent(d.slug)}/pairs`,
    body: { pairs: { [caseType]: Object.fromEntries(part.map((m) => [m.set.device, mainUrls(m)])) }, blankStock: 0 }, done: false,
  }))
  return [...steps, ...colourSteps(d.slug, caseType, models, urls)]
}

/**
 * Sends the steps not yet done, in order, marking each done when the server confirms it. One retry when there is no
 * answer or a server error (every step is idempotent). An independent step the server refuses (a 4xx for that model)
 * is left not done and the next one is sent; any other failure stops here. Stop takes effect before the next step.
 * Returns the first failure, or null. Never throws.
 */
export async function runSteps(steps: ServerStep[], o: { stopped: () => boolean; onStep: (done: number, total: number, step: ServerStep) => void }): Promise<StepFailure | null> {
  let done = steps.filter((x) => x.done).length
  let refused: StepFailure | null = null
  for (const step of steps) {
    if (step.done) continue
    if (o.stopped()) return { label: step.label, message: "", stopped: true }
    o.onStep(done, steps.length, step)
    try {
      await post(step.path, step.body).catch((error) => {
        if (error instanceof ApiError && error.status < 500) throw error
        return post(step.path, step.body)
      })
    } catch (error: any) {
      const failure = { label: step.label, message: String(error?.message ?? error), stopped: false }
      // The server refused this model (e.g. its set changed): the other models still save. No answer, a server
      // error, a lost session or a design that is gone would fail every later call too, so stop.
      const own = error instanceof ApiError && error.status < 500 && error.status !== 401 && error.status !== 404
      if (step.independent && own) { refused ??= failure; continue }
      return failure
    }
    step.done = true
    done++
  }
  return refused
}

/** Runs (or resumes) the steps with a publish job for progress. */
export function saveSteps(steps: ServerStep[], phase: "colours" | "saving", o: { stopped: () => boolean; onJob: (job: JobState) => void }) {
  return runSteps(steps, { stopped: o.stopped, onStep: (done, total, step) => o.onJob({ kind: "publish", phase, done, total, label: step.doing, eta: "" }) })
}

/**
 * Makes the gallery shots of every chosen model in every ticked colour as shop images and uploads them, the next
 * picture being made while the current one uploads. Then a new product is created (/custom with the main colours,
 * exactly as before) and each model's colours are saved, or, in update mode, the existing design's pictures are
 * replaced. Throws Stopped, Taken or an Error while nothing has been changed; a /custom call that got no answer
 * (timeout, dropped connection, gateway error) may still have created it: that error carries maybeCreated. Once the
 * product exists (or the first update request is out) it returns, with failure set if a later step failed or was
 * stopped: the steps keep their URLs, so a retry sends only the ones not done.
 */
export async function publishProduct(o: {
  settings: Settings; models: PublishModel[]; details: Details; placement: Placement; version: number
  hq: number; lowMemory: boolean; exporter: () => Promise<Renderer>
  stopped: () => boolean; onJob: (job: JobState) => void; onUploaded: (cell: string) => void; onMilestone: (pct: number) => void
}): Promise<PublishResult> {
  const { settings, details } = o
  const slug = details.slug
  const update = details.mode === "update"
  let job: JobState = { kind: "publish", phase: "checking", done: 0, total: 0, label: update ? "Loading the design…" : "Checking the URL…", eta: "" }
  const set = (patch: Partial<JobState>) => { job = { ...job, ...patch }; o.onJob(job) }
  o.onJob(job)

  const check = await fetch(`/admin/designs/${encodeURIComponent(slug)}`, { credentials: "include" })
  let existing: ExistingDesign | null = null
  if (update) {
    if (check.status === 404) throw new Error(`No design uses the URL "${slug}" any more. Make a new product instead.`)
    if (!check.ok) throw new Error(`Couldn't load the design (${check.status}). Try again.`)
    existing = (await check.json())?.design ?? null
    if (!existing || existing.kind !== "design") throw new Error("This URL belongs to a product Mockup Studio can't update.")
  } else {
    if (check.ok) throw new Taken(`The URL "${slug}" is already used by another design. Change it in Details.`)
    if (check.status !== 404) throw new Error(`Couldn't check the URL (${check.status}). Try again.`)
  }

  // the plan: (model, colour, shot), main colour first; every colour of a model uses the shots they all have
  type Item = { m: PublishModel; c: PublishColour; meta: SetMeta; shot: number; index: number; of: number }
  const plan: Item[] = []
  let perModel = 0
  for (const m of o.models) {
    const colours = [...m.colours].sort((a, b) => Number(b.main) - Number(a.main))
    if (!colours.length) throw new Error(`${m.model} has no phone colour ticked.`)
    const metas = await Promise.all(colours.map((c) => loadMeta(m.set.base_url, c.name)))
    const shots = sharedShots(settings.shots, metas)
    if (!shots.length) throw new Error(colours.length > 1 ? `${m.model}'s phone colours share none of the gallery shots.` : `${m.model} has none of the gallery shots.`)
    if (!plan.length) perModel = shots.length
    colours.forEach((c, i) => shots.forEach((n, k) => plan.push({ m, c, meta: metas[i], shot: n, index: k + 1, of: shots.length })))
  }
  if (o.stopped()) throw new Stopped()
  const total = plan.length
  set({ phase: "making", total, label: "Starting…" })

  const ex = await o.exporter()
  if (o.stopped()) throw new Stopped()
  const gen = ex.bump("publish")
  // sharper shop images: made from the 2400 px renders, then shrunk
  const superOK = settings.supersample && settings.image_size <= 1200 && !o.lowMemory
  const make = (it: Item) => {
    const big = superOK && it.c.full !== false && it.meta.sizes.includes(2400)
    const size = big ? 2400 : pickSize(it.meta.sizes, settings.image_size)
    return ex.webp({
      set: it.m.set, colour: it.c.name, shot: it.shot, placement: o.placement, lane: "publish", prio: 1, quality: settings.quality,
      size, width: big ? o.hq : designWidthFor(size, o.hq), out: superOK ? settings.image_size : undefined,
    }, gen)
  }

  const urls: Urls = {}
  const t0 = performance.now()
  let done = 0, milestone = 0
  let next: ReturnType<typeof make> | null = plan.length ? make(plan[0]) : null
  try {
    for (let i = 0; i < plan.length; i++) {
      const it = plan[i]
      const what = `${it.m.model} · ${it.c.name} · picture ${it.index} of ${it.of}`
      if (o.stopped()) throw new Stopped()
      set({ label: `Making ${what}` })
      const { blob, mime } = await next!
      if (o.stopped()) throw new Stopped()
      next = i + 1 < plan.length ? make(plan[i + 1]) : null
      next?.catch(() => undefined) // a failure is reported when it is awaited; it must not go unhandled during the upload
      set({ label: `Uploading ${what}` })
      const body = {
        designSlug: slug, caseTypeSlug: settings.case_type, deviceSlug: it.m.set.device, colourSlug: it.c.slug, index: it.index,
        filename: `${it.index}.${mime === "image/jpeg" ? "jpg" : "webp"}`, mimeType: mime, contentBase64: await blobToBase64(blob),
      }
      // one retry: a fresh upload key every time, so a retry never collides
      const uploaded = await post<{ url: string }>("/admin/designs/upload", body).catch(() => post<{ url: string }>("/admin/designs/upload", body))
      const mine = urls[it.m.set.device] ??= {}
      const list = mine[it.c.slug] ??= []
      list.push(uploaded.url)
      o.onUploaded(cellKey(it.m.set.device, it.c.name, it.shot, o.version))
      done++
      const pct = Math.floor((done / total) * 4) * 25
      if (pct > milestone && pct < 100) { milestone = pct; o.onMilestone(pct) }
      set({ done, eta: done >= 2 ? etaText((performance.now() - t0) / done, total - done) : "" })
    }
  } finally {
    // a picture still being made when this stops is not needed any more
    next?.catch(() => undefined)
  }

  // the last point where stopping leaves everything as it was
  if (o.stopped()) throw new Stopped()
  if (existing) {
    const steps = updateSteps(existing, settings.case_type, o.models, urls)
    const failure = await saveSteps(steps, "saving", o)
    return { slug, perModel, pictures: total, steps, failure }
  }

  set({ phase: "creating", label: details.status === "draft" ? "Creating the draft…" : "Publishing…", eta: "" })
  const theme = details.collection === NEW_COLLECTION ? details.newCollection.trim() : details.collection
  const pairs = Object.fromEntries(o.models.map((m) => [m.set.device, urls[m.set.device]?.[mainOf(m).slug] ?? []]))
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
  const created = result?.result?.design ?? slug
  // the product exists now: a colour call that fails or is stopped leaves it as it is, with a Retry
  const steps = colourSteps(created, settings.case_type, o.models, urls)
  const failure = await saveSteps(steps, "colours", o)
  return { slug: created, perModel, pictures: total, steps, failure }
}
