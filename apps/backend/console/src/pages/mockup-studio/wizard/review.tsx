// Mockup Studio > New product: the last step (every picture, downloads, publishing) and the
// done screen (MOCKUP_STUDIO.md).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import { shotLabel, shotTitle, type MockupSet, type Placement, type SetMeta, type Settings } from "../../../mockup/layers"
import { Button, Icon, IconButton, Progress, Segmented, Skeleton } from "../../../ui"
import { cachedThumb, cellKey, useBoxOut, useShots, type Renderers, type ShotItem } from "./engine"
import type { ExistingDesign, JobState, StepFailure } from "./export"
import { ShotCanvas, Thumb } from "./preview"
import { anglesOf, dotColour, NEW_COLLECTION, plural, sharedShots, type DesignFile, type Details, type MetaState, type SlugState, type StepId } from "./state"

export { anglesOf }

/** One chosen model. colours: the ticked ones, main first, then palette order; metas: their layer info by colour. */
export type ReviewModel = { set: MockupSet; model: string; colours: string[]; main: string; metas: Record<string, MetaState> }

const readyMeta = (m: ReviewModel, c: string): SetMeta | null => { const st = m.metas[c]; return st?.status === "ready" ? st.meta : null }
/** The shop shots of a model: the gallery shots every ticked colour has (null until every colour's info is in). */
export function modelShots(m: ReviewModel, gallery: number[]): number[] | null {
  const metas = m.colours.map((c) => readyMeta(m, c))
  return metas.every(Boolean) ? sharedShots(gallery, metas as SetMeta[]) : null
}
/** Shop pictures of every model: colours x shared shots (the gallery's length while info loads). */
export const shopPictures = (models: ReviewModel[], gallery: number[]) =>
  models.reduce((sum, m) => sum + m.colours.length * (modelShots(m, gallery)?.length ?? gallery.length), 0)

/** "Glacier has 12 of the 13 gallery shots, so every colour of this model uses those 12." */
function droppedNote(m: ReviewModel, gallery: number[], shop: number[]) {
  const own = m.colours.map((c) => ({ c, n: gallery.filter((n) => readyMeta(m, c)?.shots.some((x) => x.n === n)).length }))
  const most = Math.max(...own.map((x) => x.n))
  const short = own.filter((x) => x.n < most)
  if (!short.length || shop.length >= most) return ""
  return `${short.map((x) => x.c).join(" and ")} ${short.length > 1 ? "have" : "has"} ${short[0].n} of the ${most} gallery shots, so every colour of this model uses those ${shop.length}.`
}

export function JobBody({ job, cancel, onCancel }: { job: JobState; cancel: string; onCancel: () => void }) {
  return <div className="ms-job">
    <p className="label ms-ellipsis">{job.label}</p>
    <Progress done={job.done} total={job.total} name={job.kind === "zip" ? "Download progress" : "Publishing progress"} />
    <p className="muted ms-small ms-num">{job.eta || " "}</p>
    <div><Button id="ms-job-cancel" variant="ghost" size="small" onClick={onCancel}>{cancel}</Button></div>
  </div>
}

/** Radio chips with colour dots, main first and badged: which colour's pictures a model section shows. */
function ColourTabs({ m, value, onChange }: { m: ReviewModel; value: string; onChange: (c: string) => void }) {
  const id = useId()
  return <div className="ms-ctabs" role="radiogroup" aria-label={`Phone colour shown for ${m.model}`}>
    {m.colours.map((c) => <label key={c} className="ms-ctab">
      <input type="radio" className="sr-only" name={`ct${id}`} checked={c === value} onChange={() => onChange(c)} aria-label={`${c}${c === m.main ? ", main colour" : ""}`} />
      <i className="ms-dot-sw" style={{ "--sw": dotColour(m.set, c) } as CSSProperties} />{c}{c === m.main && <span className="ms-ctab-main" aria-hidden>Main</span>}
    </label>)}
  </div>
}

// --- the pictures --------------------------------------------------------------------------------------
export function ReviewSheet({ r, ready, active, models, settings, placement, version, uploaded, pngBusy, disabled, onOpen, onDownloadOne, onZip }: {
  r: Renderers | null; ready: boolean; active: boolean; models: ReviewModel[]; settings: Settings; placement: Placement; version: number
  uploaded: Set<string>; pngBusy: Set<string>; disabled: boolean
  onOpen: (m: ReviewModel, colour: string, shots: number[], index: number) => void
  onDownloadOne: (m: ReviewModel, colour: string, shot: number) => void
  onZip: (m: ReviewModel) => void
}) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set())
  // device -> the colour tab shown (the main colour until another is picked); only that tab's tiles are made
  const [tabs, setTabs] = useState<Record<string, string>>({})
  const tabOf = (m: ReviewModel) => (m.colours.includes(tabs[m.set.device]) ? tabs[m.set.device] : m.main)
  const io = useRef<IntersectionObserver | null>(null)
  useEffect(() => {
    io.current = new IntersectionObserver((entries) => {
      setVisible((v) => {
        let next: Set<string> | null = null
        for (const e of entries) {
          const slot = (e.target as HTMLElement).dataset.slot
          if (e.isIntersecting && slot && !v.has(slot)) (next ??= new Set(v)).add(slot)
        }
        return next ?? v
      })
    }, { rootMargin: "200px" })
    document.querySelectorAll<HTMLElement>(".ms-tile[data-slot]").forEach((el) => io.current!.observe(el))
    return () => io.current?.disconnect()
  }, [])
  const observe = useCallback((el: HTMLElement | null) => { if (el) io.current?.observe(el) }, [])
  const [out, outRef] = useBoxOut(150)

  const tabKey = models.map((m) => `${m.set.device}=${tabOf(m)}`).join(",")
  const items = useMemo(() => {
    const list: ShotItem[] = []
    for (const m of models) {
      const c = tabOf(m), meta = readyMeta(m, c)
      if (!meta) continue
      const size = Math.min(...meta.sizes)
      for (const n of anglesOf(meta, modelShots(m, settings.shots) ?? settings.shots)) {
        const slot = `${m.set.device}|${c}|${n}`
        if (visible.has(slot)) list.push({ slot, set: m.set, colour: c, shot: n, size })
      }
    }
    return list
  }, [models, settings.shots, visible, tabKey])
  const [shots, retry] = useShots(r, ready, "review", 3, items, { placement, version, out, active })

  let first = true
  return <div className="ms-groups">
    {models.map((m) => {
      const c = tabOf(m)
      const st = m.metas[c]
      const meta = st?.status === "ready" ? st.meta : null
      const shop = modelShots(m, settings.shots)
      const shopList = shop ?? settings.shots
      const angles = anglesOf(meta, shopList)
      const inShop = angles.filter((n) => shopList.includes(n)).length
      const mainShot = angles.find((n) => shopList.includes(n))
      const note = shop ? droppedNote(m, settings.shots, shop) : ""
      const failedColour = m.colours.find((x) => m.metas[x]?.status === "error")
      // 13 placeholders until the meta arrives, then one tile per meta shot (§16)
      const count = meta ? angles.length : 13
      return <section key={m.set.device} className="ms-group" aria-label={m.model}>
        <div className="ms-group-head">
          <h3>{m.model}</h3>
          {m.colours.length > 1
            ? <ColourTabs m={m} value={c} onChange={(x) => setTabs((t) => ({ ...t, [m.set.device]: x }))} />
            : <span className="badge"><i className="ms-dot-sw" style={{ "--sw": dotColour(m.set, c) } as CSSProperties} />{c}</span>}
          <span className="muted ms-small ms-num">{meta
            ? `${plural(angles.length, "picture")} · ${inShop} in the shop${m.colours.length > 1 ? ` · ${plural(m.colours.length, "colour")}` : ""}`
            : failedColour ? `${failedColour}: couldn't load the mockups.` : "Loading mockups…"}</span>
          {st?.status === "ready" && st.full === false && <span className="badge">Downloads at 1200 px</span>}
          <span className="grow" />
          <Button size="small" icon={Icon.download} disabled={disabled || !shop} aria-label={`Download ZIP of all ${m.model} pictures`} onClick={() => onZip(m)}>Download ZIP</Button>
        </div>
        {note && <p className="note warn ms-small">{note}</p>}
        <div className="ms-grid">
          {Array.from({ length: count }, (_, i) => {
            const n = angles[i]
            if (n === undefined) return <div key={`p${i}`} className="ms-tile"><span className="ms-tile-open is-placeholder"><Skeleton /></span><span className="ms-tile-label" /></div>
            const name = meta!.shots.find((x) => x.n === n)?.name ?? String(n)
            const slot = `${m.set.device}|${c}|${n}`
            const cell = cellKey(m.set.device, c, n, version)
            const ref = first ? outRef : undefined // useBoxOut's stable setter
            first = false
            const res = shots[slot]
            const failed = Boolean(res && "error" in res)
            const badges = `${n === mainShot ? ", main picture" : ""}${shopList.includes(n) ? "" : ", not in shop"}${uploaded.has(cell) ? ", uploaded" : ""}`
            return <div key={slot} className="ms-tile" data-slot={slot} ref={observe}>
              <button type="button" ref={ref} className="ms-tile-open"
                aria-label={failed ? `Try ${n}. ${shotTitle(name)} again` : `View ${c} ${n}. ${shotTitle(name)} full size${badges}`}
                onClick={() => (failed ? retry(slot) : onOpen(m, c, angles, i))}>
                <Thumb result={res} />
                {n === mainShot && <span className="ms-tile-main">Main picture</span>}
                {!shopList.includes(n) && <span className="ms-tag">Not in shop</span>}
                {uploaded.has(cell) && <span className="ms-tile-up">{Icon.check}Uploaded</span>}
              </button>
              <IconButton className="sm ms-tile-dl" label={`Download ${c} ${n}. ${shotTitle(name)} as PNG`} icon={Icon.download} loading={pngBusy.has(cell)} onClick={() => onDownloadOne(m, c, n)} />
              <span className="ms-tile-label" title={name}>{shotLabel(name)}</span>
            </div>
          })}
        </div>
      </section>
    })}
  </div>
}

// --- aside ---------------------------------------------------------------------------------------------
/** "iPhone 18 Pro Max (Black main, Silver, Glacier)" */
export const modelSummary = (m: ReviewModel) => `${m.model} (${m.colours.length > 1 ? `${m.main} main, ${m.colours.filter((c) => c !== m.main).join(", ")}` : m.main})`

export function SummaryCard({ design, models, details, placement, slugState, existing, onEdit }: {
  design: DesignFile | null; models: ReviewModel[]; details: Details; placement: Placement; slugState: SlugState
  /** Update pictures: the design being updated */
  existing: ExistingDesign | null
  onEdit: (step: StepId) => void
}) {
  const moved = placement.zoom !== 1 || placement.ox !== 0 || placement.oy !== 0
  const collection = !details.collection ? "None" : details.collection === NEW_COLLECTION ? `${details.newCollection.trim() || "…"} (new)` : details.collection
  const update = details.mode === "update"
  const rows: [string, ReactNode, StepId][] = [
    ["Design", design ? <span className="row ms-sum-file"><img src={design.url} alt="" /><span className="ms-ellipsis">{design.file.name}</span></span> : "None", "design"],
    ["Models", models.map(modelSummary).join(", ") || "None", "models"],
    ["Position", moved ? `Size ${Math.round(placement.zoom * 100)}%, moved` : "Centred", "design"],
    ...(update ? [
      ["Updating", existing ? `“${existing.name}”, pictures only` : "…", "details"],
      ["URL", <span className="row ms-sum-url">/product/{details.slug}/</span>, "details"],
      ["Collection", existing?.collection?.title ?? "None", "details"],
    ] as [string, ReactNode, StepId][] : [
      ["Title", details.name.trim() || "None", "details"],
      ["URL", <span className="row ms-sum-url">/product/{details.slug}/{slugState === "free" && Icon.check}{slugState === "taken" && Icon.alert}</span>, "details"],
      ["Collection", collection, "details"],
      ["Starting stock", details.stock.trim() || "0", "details"],
      ["Description", details.description.trim() ? (details.description.trim().length > 80 ? `${details.description.trim().slice(0, 80)}…` : details.description.trim()) : "None", "details"],
    ] as [string, ReactNode, StepId][]),
  ]
  return <section className="ms-card">
    <h3>Summary</h3>
    <dl className="ms-sum">{rows.map(([label, value, step]) => <div key={label} className="ms-sum-row">
      <dt>{label}</dt>
      <dd className="ms-sum-dd"><span className="ms-sum-val">{value}</span><button type="button" className="linkbtn" aria-label={`Edit ${label}`} onClick={() => onEdit(step)}>Edit</button></dd>
    </div>)}</dl>
  </section>
}

/** Bytes and count of the PNGs made so far, per size (2400 or 1200), for the download estimate. */
export type PngStats = Record<number, { bytes: number; n: number }>

export function DownloadCard({ models, background, onBackground, job, publishing, phone, stats, onZip, onCancel }: {
  models: ReviewModel[]; background: "white" | "transparent"; onBackground: (v: "white" | "transparent") => void
  job: JobState | null; publishing: boolean; phone: boolean; stats: PngStats; onZip: () => void; onCancel: () => void
}) {
  // MB per picture: the real average once a picture of that size was made, else 2.5 (2400) or 0.7 (1200)
  const per = (size: number, guess: number) => { const s = stats[size]; return s && s.n ? s.bytes / s.n / 1e6 : guess }
  let mb = 0, count = 0
  const low: string[] = []
  for (const m of models) {
    for (const c of m.colours) {
      const st = m.metas[c]
      const n = st?.status === "ready" ? st.meta.shots.length : 0
      const small = st?.status === "ready" && st.full === false
      if (small) low.push(m.colours.length > 1 ? `${m.model} ${c}` : m.model)
      count += n
      mb += n * (small ? per(1200, 0.7) : per(2400, 2.5))
    }
  }
  const ready = models.every((m) => m.colours.every((c) => m.metas[c]?.status === "ready"))
  return <section className="ms-card">
    <h3>Full-quality downloads</h3>
    {job?.kind === "zip" ? <JobBody job={job} cancel="Cancel" onCancel={onCancel} /> : <div className="ms-dl-body">
      <p className="muted ms-small">PNG · 2400 × 2400 px · not compressed</p>
      {low.map((what) => <p key={what} className="muted ms-small">{what} downloads at 1200 px until its 2400 px files are uploaded.</p>)}
      <div className="row between"><span className="ms-small">Background</span>
        <Segmented<"white" | "transparent"> label="Background" value={background} onChange={onBackground} options={[["white", "White"], ["transparent", "Transparent"]]} /></div>
      <span title={publishing ? "Wait for publishing to finish." : undefined}>
        <Button id="ms-zip-all" className="ms-wide" icon={Icon.download} disabled={publishing || Boolean(job) || !count || !ready} onClick={onZip}>Download all pictures (ZIP)</Button>
      </span>
      <p className="muted ms-small ms-num">About {Math.max(1, Math.round(mb)).toLocaleString("en-US")} MB · {plural(count, "picture")}</p>
      {phone && count > 26 && <p className="muted ms-small">Large download. Keep this tab open until it is saved.</p>}
    </div>}
  </section>
}

/**
 * maybeCreated: the create request got no answer, so the product may exist even though this failed.
 * partial: Update pictures got part of the way (done of total saves); Retry sends only the rest.
 */
export type PublishError = { message: string; taken?: boolean; stopped?: boolean; maybeCreated?: boolean; partial?: { done: number; total: number; label: string } }
const PHASE: Record<JobState["phase"], string> = {
  checking: "Checking the URL", making: "Making and uploading pictures", creating: "Creating the product",
  colours: "Saving phone colours", saving: "Saving the pictures", zipping: "Making and uploading pictures",
}
/** Publishing this many pictures takes a while (about eight minutes or more). */
export const LONG_PUBLISH = 500

export function PublishCard({ status, onStatus, settings, mode, caseTypeName, replace, pictures, estimate, job, error, slug, onStop, onRetry, onChangeUrl, onUpdateMode, onOpenSettings }: {
  status: "draft" | "published"; onStatus: (v: "draft" | "published") => void; settings: Settings
  mode: "new" | "update"; caseTypeName: string
  /** Update pictures: models whose pictures are replaced, and models the design gets */
  replace: { replaced: number; added: number }
  pictures: number; estimate: string
  job: JobState | null; error: PublishError | null; slug: string
  onStop: () => void; onRetry: () => void; onChangeUrl: () => void; onUpdateMode: () => void; onOpenSettings: () => void
}) {
  const running = job?.kind === "publish"
  // once the create request is out, stopping can no longer leave no product: Stop stays focusable but does nothing
  const creating = running && job.phase === "creating"
  const update = mode === "update"
  const again = update ? "Update again" : "Publish again"
  return <section className="ms-card">
    <h3>{update ? "Update pictures" : "Shop images"}</h3>
    <div className="ms-pub-body">
      {running
        ? <>
          <h3>{PHASE[job.phase]}</h3>
          <p className="label ms-ellipsis">{job.label}</p>
          <Progress done={job.done} total={Math.max(job.total, 1)} name="Publishing progress" />
          <p className="muted ms-small ms-num">Keep this tab open. {job.eta}</p>
          <div><Button id="ms-pub-stop" variant="ghost" size="small" aria-disabled={creating || undefined}
            title={creating ? "The product is being created now and can't be stopped." : undefined}
            onClick={creating ? undefined : onStop}>Stop</Button></div>
        </>
        : <>
          {update
            ? <>
              <p className="ms-small">Replaces the {caseTypeName} pictures of {plural(replace.replaced + replace.added, "model")} (main colour plus phone colours). Other case types and models are not touched. Variant IDs, prices, stock, carts and orders stay.</p>
              {replace.added > 0 && <p className="muted ms-small">{replace.added === 1 ? "1 model is" : `${replace.added} models are`} new to this design and {replace.added === 1 ? "is" : "are"} added with {replace.added === 1 ? "its" : "their"} shared blank stock.</p>}
            </>
            : <>
              <div className="row between"><span className="ms-small">Save as</span>
                <Segmented<"draft" | "published"> label="Save as" value={status} onChange={onStatus} disabled={Boolean(job)} options={[["draft", "Draft"], ["published", "Publish now"]]} /></div>
              <p className="ms-small">We'll make {plural(pictures, "shop picture")} at {settings.image_size} px, WebP quality {settings.quality}, compressed now for fast pages. Your downloads stay full quality.</p>
            </>}
          <p className="muted ms-small ms-num">{estimate}</p>
          {pictures > LONG_PUBLISH && <p className="note ms-small">Publishing takes a while; keep this tab open.</p>}
          {!update && status === "draft" && <p className="muted ms-small">Drafts stay hidden from the shop until you publish them in Product Manager.</p>}
          {settings.quality < 90 && <p className="note warn">Quality {settings.quality} loses fine detail. 92 is recommended. <button type="button" className="linkbtn" onClick={onOpenSettings}>Change in Settings</button></p>}
          {error?.partial && <div className={`note${error.stopped ? "" : " error"}`} role={error.stopped ? "status" : "alert"}>
            <p>{error.stopped ? "Stopped." : `Couldn't save ${error.partial.label}: ${error.message}`}</p>
            <p>{error.partial.done} of {error.partial.total} saves are done. {error.stopped ? "Continue sends the rest." : "Retry sends only the rest; nothing is uploaded again."}</p>
            <Button id="ms-pub-retry" size="small" onClick={onRetry}>{error.stopped ? "Continue" : "Retry"}</Button>
          </div>}
          {error?.stopped && !error.partial && <div className="note" role="status"><p>Stopped. Nothing was {update ? "changed" : "created"}.</p><Button id="ms-pub-retry" size="small" onClick={onRetry}>{again}</Button></div>}
          {error && !error.stopped && !error.partial && <div className="note error" role="alert">
            {error.taken
              ? <><p>This URL is already used by another design.</p><div className="row"><Button id="ms-pub-retry" size="small" onClick={onChangeUrl}>Change URL</Button>
                <Button size="small" onClick={onUpdateMode}>Update its pictures instead</Button></div></>
              : error.maybeCreated
                ? <><p>Publishing stopped: {error.message}</p><p>The product may have been created. Check Product Manager before trying again.</p>
                  <div className="row"><a className="btn small" href={`/app/product-manager?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">Open in Product Manager</a>
                    <Button id="ms-pub-retry" size="small" onClick={onRetry}>Try again</Button></div></>
                : <><p>{update ? "Updating" : "Publishing"} stopped: {error.message}</p><p>Nothing was {update ? "changed" : "created"}. Your work is still here.</p><Button id="ms-pub-retry" size="small" onClick={onRetry}>Try again</Button></>}
          </div>}
        </>}
    </div>
  </section>
}

// --- done ------------------------------------------------------------------------------------------------
/** colours: a new product's phone colour calls that are not saved yet (Retry sends them). */
export type Done = {
  slug: string; status: "draft" | "published"; mode: "new" | "update"; models: number; colourSets: number; perModel: number; title: string
  colours: { left: number; failure: StepFailure } | null
}

export function DoneScreen({ done, first, version, placement, job, onZip, onCancel, onAgain, onRetryColours, onStopColours }: {
  done: Done; first: { set: MockupSet; colour: string; shots: number[] } | null; version: number; placement: Placement
  job: JobState | null; onZip: () => void; onCancel: () => void; onAgain: () => void
  /** a new product's phone colour calls: send the rest again, and stop after the current one */
  onRetryColours: () => void; onStopColours: () => void
}) {
  const shop = `${location.origin.replace("//api.", "//")}/product/${done.slug}/`
  const title = done.mode === "update" ? "Pictures updated" : done.status === "published" ? "Product published" : "Draft created"
  const saving = job?.kind === "publish"
  return <div className="ms-done">
    <span className="ms-done-mark">{Icon.check}</span>
    <h2 className="ms-title" id="ms-h" tabIndex={-1}>{title}</h2>
    <p>“{done.title}”: {plural(done.models, "model")}{done.colourSets > done.models ? ` in ${plural(done.colourSets, "colour set")}` : ""}, {done.perModel} pictures each.</p>
    {done.colours && !saving && <div className="note warn ms-done-note" role="status">
      <p>Product created. Phone colour pictures for {plural(done.colours.left, "model")} {done.colours.failure.stopped ? "were not saved: you pressed Stop." : `couldn't be saved: ${done.colours.failure.message}`}</p>
      <p className="ms-small">The product shows its main pictures until then.</p>
      <Button id="ms-colours-retry" size="small" disabled={Boolean(job)} onClick={onRetryColours}>Retry</Button>
    </div>}
    {saving && <div className="ms-done-job"><JobBody job={job} cancel="Stop" onCancel={onStopColours} /></div>}
    <div className="ms-done-strip">
      {Array.from({ length: 4 }, (_, i) => {
        const n = first?.shots[i]
        const b = first && n !== undefined ? cachedThumb(cellKey(first.set.device, first.colour, n, version), placement) : null
        return <div key={i}>{b ? <ShotCanvas bitmap={b} /> : <Skeleton />}</div>
      })}
    </div>
    <div className="row ms-done-actions">
      <a className="btn primary" href={`/app/product-manager?slug=${encodeURIComponent(done.slug)}`} target="_blank" rel="noreferrer">Open in Product Manager</a>
      {done.status === "published" && <a className="btn" href={shop} target="_blank" rel="noreferrer">View in shop</a>}
      <Button id="ms-zip-all" icon={Icon.download} disabled={Boolean(job)} onClick={onZip}>Download all pictures (ZIP)</Button>
      <Button variant="ghost" disabled={Boolean(job)} onClick={onAgain}>Make another</Button>
    </div>
    {job?.kind === "zip" && <div className="ms-done-job"><JobBody job={job} cancel="Cancel" onCancel={onCancel} /></div>}
  </div>
}
