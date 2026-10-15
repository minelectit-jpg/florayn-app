// Mockup Studio > New product: step 5 (every picture, downloads, publishing) and the
// done screen (MOCKUP_STUDIO.md).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import { shotLabel, shotTitle, type MockupSet, type Placement, type SetMeta, type Settings } from "../../../mockup/layers"
import { Button, Icon, IconButton, Progress, Segmented, Skeleton } from "../../../ui"
import { cachedThumb, cellKey, useBoxOut, useShots, type Renderers, type ShotItem } from "./engine"
import type { JobState } from "./export"
import { ShotCanvas, Thumb } from "./preview"
import { NEW_COLLECTION, plural, swatchColour, type DesignFile, type Details, type MetaState, type SlugState, type StepId } from "./state"

export type ReviewModel = { set: MockupSet; colour: string; model: string; meta: MetaState | undefined }

/** Every meta shot: the gallery ones in gallery order, then the rest. */
export function anglesOf(meta: SetMeta | null, gallery: number[]) {
  if (!meta) return []
  const have = new Set(meta.shots.map((x) => x.n))
  return [...gallery.filter((n) => have.has(n)), ...meta.shots.map((x) => x.n).filter((n) => !gallery.includes(n))]
}

export function JobBody({ job, cancel, onCancel }: { job: JobState; cancel: string; onCancel: () => void }) {
  return <div className="ms-job">
    <p className="label ms-ellipsis">{job.label}</p>
    <Progress done={job.done} total={job.total} name={job.kind === "zip" ? "Download progress" : "Publishing progress"} />
    <p className="muted ms-small ms-num">{job.eta || " "}</p>
    <div><Button id="ms-job-cancel" variant="ghost" size="small" onClick={onCancel}>{cancel}</Button></div>
  </div>
}

// --- the pictures --------------------------------------------------------------------------------------
export function ReviewSheet({ r, ready, active, models, settings, placement, version, uploaded, pngBusy, disabled, onOpen, onDownloadOne, onZip }: {
  r: Renderers | null; ready: boolean; active: boolean; models: ReviewModel[]; settings: Settings; placement: Placement; version: number
  uploaded: Set<string>; pngBusy: Set<string>; disabled: boolean
  onOpen: (m: ReviewModel, shots: number[], index: number) => void
  onDownloadOne: (m: ReviewModel, shot: number) => void
  onZip: (m: ReviewModel) => void
}) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set())
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

  const items = useMemo(() => {
    const list: ShotItem[] = []
    for (const m of models) {
      if (m.meta?.status !== "ready") continue
      const size = Math.min(...m.meta.meta.sizes)
      for (const n of anglesOf(m.meta.meta, settings.shots)) {
        const slot = `${m.set.device}|${n}`
        if (visible.has(slot)) list.push({ slot, set: m.set, colour: m.colour, shot: n, size })
      }
    }
    return list
  }, [models, settings.shots, visible])
  const [shots, retry] = useShots(r, ready, "review", 3, items, { placement, version, out, active })

  let first = true
  return <div className="ms-groups">
    {models.map((m) => {
      const meta = m.meta?.status === "ready" ? m.meta.meta : null
      const angles = anglesOf(meta, settings.shots)
      const inShop = angles.filter((n) => settings.shots.includes(n)).length
      const mainShot = angles.find((n) => settings.shots.includes(n))
      // 13 placeholders until the meta arrives, then one tile per meta shot (§16)
      const count = meta ? angles.length : 13
      return <section key={m.set.device} className="ms-group" aria-label={m.model}>
        <div className="ms-group-head">
          <h3>{m.model}</h3>
          <span className="badge"><i className="ms-dot-sw" style={{ "--sw": swatchColour(m.colour) } as CSSProperties} />{m.colour}</span>
          <span className="muted ms-small ms-num">{meta ? `${plural(angles.length, "picture")} · ${inShop} in the shop` : m.meta?.status === "error" ? "Couldn't load the mockups." : "Loading mockups…"}</span>
          {m.meta?.status === "ready" && m.meta.full === false && <span className="badge">Downloads at 1200 px</span>}
          <span className="grow" />
          <Button size="small" icon={Icon.download} disabled={disabled || !meta} aria-label={`Download ZIP of all ${m.model} pictures`} onClick={() => onZip(m)}>Download ZIP</Button>
        </div>
        <div className="ms-grid">
          {Array.from({ length: count }, (_, i) => {
            const n = angles[i]
            if (n === undefined) return <div key={`p${i}`} className="ms-tile"><span className="ms-tile-open is-placeholder"><Skeleton /></span><span className="ms-tile-label" /></div>
            const name = meta!.shots.find((x) => x.n === n)?.name ?? String(n)
            const slot = `${m.set.device}|${n}`
            const cell = cellKey(m.set.device, m.colour, n, version)
            const ref = first ? outRef : undefined // useBoxOut's stable setter
            first = false
            const res = shots[slot]
            const failed = Boolean(res && "error" in res)
            const badges = `${n === mainShot ? ", main picture" : ""}${settings.shots.includes(n) ? "" : ", not in shop"}${uploaded.has(cell) ? ", uploaded" : ""}`
            return <div key={slot} className="ms-tile" data-slot={slot} ref={observe}>
              <button type="button" ref={ref} className="ms-tile-open"
                aria-label={failed ? `Try ${n}. ${shotTitle(name)} again` : `View ${n}. ${shotTitle(name)} full size${badges}`}
                onClick={() => (failed ? retry(slot) : onOpen(m, angles, i))}>
                <Thumb result={res} />
                {n === mainShot && <span className="ms-tile-main">Main picture</span>}
                {!settings.shots.includes(n) && <span className="ms-tag">Not in shop</span>}
                {uploaded.has(cell) && <span className="ms-tile-up">{Icon.check}Uploaded</span>}
              </button>
              <IconButton className="sm ms-tile-dl" label={`Download ${n}. ${shotTitle(name)} as PNG`} icon={Icon.download} loading={pngBusy.has(cell)} onClick={() => onDownloadOne(m, n)} />
              <span className="ms-tile-label" title={name}>{shotLabel(name)}</span>
            </div>
          })}
        </div>
      </section>
    })}
  </div>
}

// --- aside ---------------------------------------------------------------------------------------------
export function SummaryCard({ design, models, details, placement, slugState, onEdit }: {
  design: DesignFile | null; models: ReviewModel[]; details: Details; placement: Placement; slugState: SlugState
  onEdit: (step: StepId) => void
}) {
  const moved = placement.zoom !== 1 || placement.ox !== 0 || placement.oy !== 0
  const collection = !details.collection ? "None" : details.collection === NEW_COLLECTION ? `${details.newCollection.trim() || "…"} (new)` : details.collection
  const rows: [string, ReactNode, StepId][] = [
    ["Design", design ? <span className="row ms-sum-file"><img src={design.url} alt="" /><span className="ms-ellipsis">{design.file.name}</span></span> : "None", "design"],
    ["Models", models.map((m) => `${m.model} (${m.colour})`).join(", ") || "None", "models"],
    ["Position", moved ? `Size ${Math.round(placement.zoom * 100)}%, moved` : "Centred", "placement"],
    ["Title", details.name.trim() || "None", "details"],
    ["URL", <span className="row ms-sum-url">/product/{details.slug}/{slugState === "free" && Icon.check}{slugState === "taken" && Icon.alert}</span>, "details"],
    ["Collection", collection, "details"],
    ["Starting stock", details.stock.trim() || "0", "details"],
    ["Description", details.description.trim() ? (details.description.trim().length > 80 ? `${details.description.trim().slice(0, 80)}…` : details.description.trim()) : "None", "details"],
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
  const low = models.filter((m) => m.meta?.status === "ready" && m.meta.full === false)
  // MB per picture: the real average once a picture of that size was made, else 2.5 (2400) or 0.7 (1200)
  const per = (size: number, guess: number) => { const s = stats[size]; return s && s.n ? s.bytes / s.n / 1e6 : guess }
  let mb = 0, count = 0
  for (const m of models) {
    const n = m.meta?.status === "ready" ? m.meta.meta.shots.length : 0
    count += n
    mb += n * (m.meta?.status === "ready" && m.meta.full === false ? per(1200, 0.7) : per(2400, 2.5))
  }
  return <section className="ms-card">
    <h3>Full-quality downloads</h3>
    {job?.kind === "zip" ? <JobBody job={job} cancel="Cancel" onCancel={onCancel} /> : <div className="ms-dl-body">
      <p className="muted ms-small">PNG · 2400 × 2400 px · not compressed</p>
      {low.map((m) => <p key={m.set.device} className="muted ms-small">{m.model} downloads at 1200 px until its 2400 px files are uploaded.</p>)}
      <div className="row between"><span className="ms-small">Background</span>
        <Segmented<"white" | "transparent"> label="Background" value={background} onChange={onBackground} options={[["white", "White"], ["transparent", "Transparent"]]} /></div>
      <span title={publishing ? "Wait for publishing to finish." : undefined}>
        <Button id="ms-zip-all" className="ms-wide" icon={Icon.download} disabled={publishing || Boolean(job) || !count} onClick={onZip}>Download all pictures (ZIP)</Button>
      </span>
      <p className="muted ms-small ms-num">About {Math.max(1, Math.round(mb))} MB · {plural(count, "picture")}</p>
      {phone && models.length > 2 && <p className="muted ms-small">Large download. Keep this tab open until it is saved.</p>}
    </div>}
  </section>
}

/** maybeCreated: the create request got no answer, so the product may exist even though this failed. */
export type PublishError = { message: string; taken?: boolean; stopped?: boolean; maybeCreated?: boolean }
const PHASE: Record<string, string> = { checking: "Checking the URL", making: "Making and uploading pictures", creating: "Creating the product", zipping: "Making and uploading pictures" }

export function PublishCard({ status, onStatus, settings, pictures, job, error, slug, onStop, onRetry, onChangeUrl, onOpenSettings }: {
  status: "draft" | "published"; onStatus: (v: "draft" | "published") => void; settings: Settings; pictures: number
  job: JobState | null; error: PublishError | null; slug: string
  onStop: () => void; onRetry: () => void; onChangeUrl: () => void; onOpenSettings: () => void
}) {
  const running = job?.kind === "publish"
  // once the create request is out, stopping can no longer leave no product: Stop stays focusable but does nothing
  const creating = running && job.phase === "creating"
  return <section className="ms-card">
    <h3>Shop images</h3>
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
          <div className="row between"><span className="ms-small">Save as</span>
            <Segmented<"draft" | "published"> label="Save as" value={status} onChange={onStatus} disabled={Boolean(job)} options={[["draft", "Draft"], ["published", "Publish now"]]} /></div>
          <p className="ms-small">We'll make {pictures} shop pictures at {settings.image_size} px, WebP quality {settings.quality}, compressed now for fast pages. Your downloads stay full quality.</p>
          {status === "draft" && <p className="muted ms-small">Drafts stay hidden from the shop until you publish them in Product Manager.</p>}
          {settings.quality < 90 && <p className="note warn">Quality {settings.quality} loses fine detail. 92 is recommended. <button type="button" className="linkbtn" onClick={onOpenSettings}>Change in Settings</button></p>}
          {error?.stopped && <div className="note" role="status"><p>Stopped. Nothing was created.</p><Button id="ms-pub-retry" size="small" onClick={onRetry}>Publish again</Button></div>}
          {error && !error.stopped && <div className="note error" role="alert">
            {error.taken
              ? <><p>This URL is already used by another design.</p><Button id="ms-pub-retry" size="small" onClick={onChangeUrl}>Change URL</Button></>
              : error.maybeCreated
                ? <><p>Publishing stopped: {error.message}</p><p>The product may have been created. Check Product Manager before trying again.</p>
                  <div className="row"><a className="btn small" href={`/app/product-manager?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">Open in Product Manager</a>
                    <Button id="ms-pub-retry" size="small" onClick={onRetry}>Try again</Button></div></>
                : <><p>Publishing stopped: {error.message}</p><p>Nothing was created. Your work is still here.</p><Button id="ms-pub-retry" size="small" onClick={onRetry}>Try again</Button></>}
          </div>}
        </>}
    </div>
  </section>
}

// --- done ------------------------------------------------------------------------------------------------
export type Done = { slug: string; status: "draft" | "published"; models: number; perModel: number; title: string }

export function DoneScreen({ done, first, version, placement, job, onZip, onCancel, onAgain }: {
  done: Done; first: { set: MockupSet; colour: string; shots: number[] } | null; version: number; placement: Placement
  job: JobState | null; onZip: () => void; onCancel: () => void; onAgain: () => void
}) {
  const shop = `${location.origin.replace("//api.", "//")}/product/${done.slug}/`
  return <div className="ms-done">
    <span className="ms-done-mark">{Icon.check}</span>
    <h2 className="ms-title" id="ms-h" tabIndex={-1}>{done.status === "published" ? "Product published" : "Draft created"}</h2>
    <p>“{done.title}”: {plural(done.models, "model")}, {done.perModel} pictures each.</p>
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
