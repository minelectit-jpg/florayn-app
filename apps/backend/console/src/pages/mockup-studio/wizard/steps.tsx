// Mockup Studio > New product: the panels of steps 1-4 (MOCKUP_STUDIO.md).
import { useEffect, useId, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react"

import { CENTERED, shotLabel, type MockupSet, type Placement, type SetMeta } from "../../../mockup/layers"
import { Button, Icon, IconButton, Segmented, slugify } from "../../../ui"
import type { ShotResult } from "./engine"
import type { ExistingDesign } from "./export"
import { ColourChecks, leaveDrop, ShotCanvas, Thumb, type Placer } from "./preview"
import {
  colourList, colourOrder, fieldErrors, limits, mainColourOf, NEW_COLLECTION, plural, sharpness, STEPS,
  type ColourMode, type DesignFile, type Details, type MetaState, type Pick, type SlugState, type State, type StepId,
} from "./state"

export function StepHead({ step, title, sub }: { step: StepId; title: string; sub: ReactNode }) {
  const i = STEPS.findIndex((s) => s.id === step) + 1
  return <header className="ms-sh">
    <span className="ms-eyebrow">Step {i} of 5</span>
    <h2 className="ms-title" id="ms-h" tabIndex={-1}>{title}</h2>
    <p className="ms-sub">{sub}</p>
  </header>
}

const SHARP_TEXT = [
  "",
  "Low resolution. Close-ups will look blurry. Use a file 3000 px wide or more if you have one.",
  "Good for the shop. Close-ups may look a little soft.",
  "Sharp. Close-ups and 2400 px downloads look crisp.",
]

function Meter({ level }: { level: number }) {
  return <span className="ms-meter" data-level={level} aria-hidden><i /><i /><i /></span>
}

// --- step 1 ------------------------------------------------------------------------------------------
export function DesignPanel({ design, reading, error, A, maxAcross, disabled, onChoose, onFile, onRemove }: {
  design: DesignFile | null; reading: string | null; error: string; A: number; maxAcross: number
  /** a ZIP or publish is running: the design cannot change */
  disabled?: boolean
  onChoose: () => void; onFile: (f: File) => void; onRemove: () => void
}) {
  const [over, setOver] = useState(false)
  const onDragOver = (e: DragEvent) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setOver(true) }
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }
  const errorNote = error ? <p className="note error" role="alert">{error}</p> : null

  if (!design) {
    return <div className="ms-panel">
      <div className={`ms-dropzone${over ? " is-over" : ""}`} aria-busy={reading ? true : undefined}
        onDragOver={onDragOver} onDragLeave={leaveDrop(setOver)} onDrop={onDrop}
        onClick={(e) => { if (!reading && !(e.target as HTMLElement).closest("button")) onChoose() }}>
        {reading
          ? <><span className="spin ms-spin-lg" aria-hidden /><strong>Opening your design…</strong><span className="muted ms-small">{reading}</span></>
          : <>
            <span className="ms-dropzone-icon">{Icon.upload}</span>
            <span className="ms-dropzone-title">{over ? "Drop to use this design" : "Drop your design here"}</span>
            <span className="row ms-or"><span className="muted">or</span><Button id="ms-choose" variant="primary" size="small" onClick={onChoose}>Choose file</Button></span>
            <span className="muted ms-small">PNG, JPG or WebP · portrait 5 : 8 · 3000 px wide or more for sharp close-ups</span>
          </>}
      </div>
      {errorNote}
      <section className="ms-sec">
        <span className="lbl">What works best</span>
        <ul className="ms-tips">
          <li>Portrait 5 : 8, the shape of the print (105 × 168 mm)</li>
          <li>3000 px wide or more, so close-ups stay sharp</li>
          <li>The design covers the back and wraps around the sides</li>
        </ul>
        <p className="muted ms-small">Tip: you can also paste an image (Ctrl+V).</p>
      </section>
    </div>
  }

  const k = design.scale
  // shrunk further than maxAcross asks: this device's canvas limit, not "more than any picture needs"
  const byArea = k < Math.min(1, maxAcross / design.across) - 1e-6
  const level = sharpness(design.across, 1)
  const r = (design.w / design.h) * A
  return <div className="ms-panel">
    <div className="ms-ready">
      <div className="ms-file">
        <img className="ms-file-thumb" src={design.url} alt="" />
        <div className="ms-file-info">
          <span className="ms-file-name" title={design.file.name}>{design.file.name}</span>
          <span className="muted ms-num">{design.w} × {design.h} px · {(design.file.size / 1e6).toFixed(1)} MB</span>
          <span className="row" style={{ gap: 6 }}>
            <Button id="ms-choose" size="small" icon={Icon.upload} loading={Boolean(reading)} disabled={disabled} onClick={onChoose}>Replace</Button>
            <Button size="small" variant="ghost" disabled={disabled} onClick={onRemove}>Remove</Button>
          </span>
        </div>
      </div>
      {design.reduced && <p className="muted ms-small">{byArea
        ? `Very large file. This device uses ${Math.round(design.w * k)} × ${Math.round(design.h * k)} px of it.`
        : `Very large file. The studio uses ${Math.round(design.w * k)} × ${Math.round(design.h * k)} px of it, more than any picture needs.`}</p>}
      <div className="ms-sharp"><span className="lbl">Sharpness</span><Meter level={level} /><span className="ms-small">{SHARP_TEXT[level]}</span></div>
    </div>
    {Math.abs(r - 1) > 0.06 && <p className="note warn">Your design is {r > 1 ? "wider" : "taller"} than the case. The {r > 1 ? "left and right" : "top and bottom"} edges are trimmed. You can move it in Placement.</p>}
    {errorNote}
  </div>
}

// --- step 2 ------------------------------------------------------------------------------------------
export function EmptyModels({ onOpenSets }: { onOpenSets: () => void }) {
  return <div className="ms-empty card">
    <span className="ms-empty-icon">{Icon.phone}</span>
    <h3>No models are ready yet</h3>
    <p className="muted">A model needs its mockup files before it can be used here. Turn one on in Mockup sets.</p>
    <Button variant="primary" onClick={onOpenSets}>Open Mockup sets</Button>
  </div>
}

export function ModelsStep({ sets, pickOf, metas, cards, cardRef, deviceName, disabled, colourMode, estimate, picturesOf, onToggle, onAll, onColour, onAllColours, onRetryMeta, onCardRetry }: {
  sets: MockupSet[]; pickOf: (s: MockupSet) => Pick; metas: Record<string, MetaState>
  cards: Record<string, ShotResult>; cardRef: (el: HTMLElement | null) => void; deviceName: (slug: string) => string; disabled?: boolean
  /** the toolbar's Main only | All colours, and the live estimate of what publishing makes */
  colourMode: ColourMode; estimate: string
  /** a chosen model's shop pictures: ticked colours x the shots they share */
  picturesOf: (s: MockupSet) => number
  onToggle: (s: MockupSet) => void; onAll: (on: boolean) => void; onColour: (s: MockupSet, colour: string) => void; onAllColours: (on: boolean) => void
  onRetryMeta: () => void; onCardRetry: (slot: string) => void
}) {
  const [q, setQ] = useState("")
  const allRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const count = sets.filter((s) => pickOf(s).on).length
  const multi = sets.some((s) => s.colours.length > 1)
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = count > 0 && count < sets.length }, [count, sets.length])
  const needle = q.trim().toLowerCase()
  const shown = needle ? sets.filter((s) => deviceName(s.device).toLowerCase().includes(needle)) : sets
  return <>
    <div className="ms-mtools">
      <label className="row ms-all"><input id="ms-all" ref={allRef} type="checkbox" className="check" checked={count === sets.length && count > 0} disabled={disabled} onChange={(e) => onAll(e.target.checked)} /><strong>All models</strong></label>
      <span className="muted ms-num">{count} of {sets.length} chosen</span>
      {multi && <span className="row ms-cmode"><span className="muted ms-small" aria-hidden>Phone colours</span>
        <Segmented<ColourMode> label="Phone colours" value={colourMode} disabled={disabled} onChange={(v) => onAllColours(v === "all")} options={[["main", "Main only"], ["all", "All colours"]]} /></span>}
      {sets.length > 8 && <input ref={searchRef} className="input" type="search" placeholder="Search models" aria-label="Search models" value={q} onChange={(e) => setQ(e.target.value)} />}
    </div>
    <p className="muted ms-small ms-num ms-estimate">{count ? estimate : "Choose a model to see how many pictures are made."}</p>
    {shown.length
      ? <ul className="ms-mgrid">{shown.map((s, i) => <ModelCard key={s.device} set={s} pick={pickOf(s)} metas={metas} card={cards[s.device]} pictures={picturesOf(s)}
        model={deviceName(s.device)} thumbRef={i === 0 ? cardRef : undefined} disabled={disabled}
        onToggle={() => onToggle(s)} onColour={(c) => onColour(s, c)} onRetry={onRetryMeta} onCardRetry={() => onCardRetry(s.device)} />)}</ul>
      : <div className="ms-empty"><p>No models match “{q.trim()}”.</p><Button onClick={() => { setQ(""); searchRef.current?.focus() }}>Clear search</Button></div>}
    <p className="muted ms-note">The phone colour only changes the phone in the pictures, not what is sold.</p>
  </>
}

function ModelCard({ set, pick, metas, card, pictures, model, thumbRef, disabled, onToggle, onColour, onRetry, onCardRetry }: {
  set: MockupSet; pick: Pick; metas: Record<string, MetaState>; card: ShotResult | undefined; pictures: number; model: string
  thumbRef?: (el: HTMLElement | null) => void; disabled?: boolean
  onToggle: () => void; onColour: (c: string) => void; onRetry: () => void; onCardRetry: () => void
}) {
  const meta = metas[`${set.device}|${pick.stage}`]
  const failed = meta?.status === "error"
  // a ticked colour whose layer info failed blocks Continue: say which
  const badColour = pick.on ? pick.colours.find((c) => metas[`${set.device}|${c}`]?.status === "error") : failed ? pick.stage : undefined
  const cardFailed = !failed && Boolean(card && "error" in card)
  const sid = useId()
  const main = mainColourOf(set, pick)
  // only the words describe the checkbox; a Retry button stays out of its description
  let status: ReactNode = "", cls = ""
  if (badColour) { cls = " is-error"; status = <><span id={sid}>{set.colours.length > 1 ? `${badColour}: couldn't load the mockups.` : "Couldn't load the mockups."}</span> <button type="button" className="linkbtn" onClick={onRetry}>Retry</button></> }
  else if (!meta || meta.status === "loading") status = <span id={sid}>Loading mockups…</span>
  else if (cardFailed) { cls = " is-error"; status = <><span id={sid}>Couldn't make the picture.</span> <button type="button" className="linkbtn" onClick={onCardRetry}>Retry</button></> }
  else if (meta.status === "ready" && meta.full === true) { cls = " is-ok"; status = <span id={sid}>Full quality ready</span> }
  else if (meta.status === "ready" && meta.full === false) status = <span id={sid}>Downloads at 1200 px</span>
  const line = pick.on ? `${colourList(colourOrder(set, pick))} — ${plural(pictures, "picture")}` : pick.stage
  return <li className={`ms-mcard${pick.on ? " is-on" : ""}`}>
    <label className="ms-mcard-toggle">
      <input type="checkbox" className="sr-only" checked={pick.on} disabled={disabled || (failed && !pick.on)} aria-label={model} aria-describedby={status ? sid : undefined} onChange={onToggle} />
      <span className="ms-mcard-thumb" ref={thumbRef}>
        {failed && meta?.status === "error" ? <span className="ms-thumb-error" title={meta.message}>{Icon.alert}</span> : <Thumb result={card} onRetry={onCardRetry} />}
        <span className="ms-mcard-check" aria-hidden>{Icon.check}</span>
      </span>
      <span className="ms-mcard-name" title={model}>{model}</span>
    </label>
    <div className="ms-mcard-foot">
      <ColourChecks set={set} on={pick.on} colours={pick.colours} main={main} model={model} disabled={disabled} onToggle={onColour} />
      <span className="ms-mcard-colour" title={line}>{line}</span>
    </div>
    <p className={`ms-mcard-status${cls}`}>{status}</p>
  </li>
}

// --- step 3 ------------------------------------------------------------------------------------------
function Range({ min, max, value, label, valueText, disabled, onBegin, onSet, onApply, onEnd }: {
  min: number; max: number; value: number; label: string; valueText: string; disabled?: boolean
  onBegin: () => void; onSet: (v: number) => void; onApply: (v: number) => void; onEnd: () => void
}) {
  const drag = useRef(false)
  const end = () => { if (drag.current) { drag.current = false; onEnd() } }
  // a direction that cannot move: a centred, disabled slider
  if (max <= min) { min = -1; max = 1; value = 0 }
  const pct = ((value - min) / (max - min)) * 100
  return <input type="range" className="ms-range" min={min} max={max} step={1} value={value} disabled={disabled}
    aria-label={label} aria-valuetext={valueText} style={{ "--fill": `${pct}%` } as CSSProperties}
    onPointerDown={() => { drag.current = true; onBegin() }} onPointerUp={end} onPointerCancel={end} onBlur={end}
    onChange={(e) => { const v = Number(e.target.value); if (drag.current) onSet(v); else onApply(v) }} />
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`
/** A position offset (percent) in words, for screen readers: "4 percent left", "centred". */
export const way = (v: number, neg: string, pos: string) => (v ? `${Math.abs(v)} percent ${v < 0 ? neg : pos}` : "centred")

/** The flat print with the design on it, exactly as placeDesign draws it; drag here moves the design 1:1. */
function PrintPreview({ design, placement, A, placer }: { design: DesignFile; placement: Placement; A: number; placer: Placer }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const start = useRef<{ x: number; y: number; p: Placement; w: number; h: number } | null>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !design.preview.width) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const W = Math.round((c.clientWidth || 96) * dpr), H = Math.round(W * A)
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
    const g = c.getContext("2d")
    if (!g) return
    const img = design.preview
    g.fillStyle = "#fff"
    g.fillRect(0, 0, W, H)
    const s = Math.max(W / img.width, H / img.height) * placement.zoom
    const dw = img.width * s, dh = img.height * s
    g.imageSmoothingQuality = "high"
    g.drawImage(img, (W - dw) / 2 + placement.ox * W, (H - dh) / 2 + placement.oy * H, dw, dh)
  }, [design.preview, placement.zoom, placement.ox, placement.oy, A])
  return <canvas ref={ref} role="img" aria-label="Print area preview"
    onPointerDown={(e) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      const r = e.currentTarget.getBoundingClientRect()
      start.current = { x: e.clientX, y: e.clientY, p: placement, w: r.width, h: r.height }
      placer.begin()
    }}
    onPointerMove={(e) => {
      const s = start.current
      if (!s) return
      placer.set({ ...s.p, ox: s.p.ox + (e.clientX - s.x) / s.w, oy: s.p.oy + (e.clientY - s.y) / s.h })
    }}
    onPointerUp={() => { if (start.current) { start.current = null; placer.end() } }}
    onPointerCancel={() => { if (start.current) { start.current = null; placer.end() } }} />
}

const CHIPS = ["Camera", "Bottom", "Buttons", "Right side", "Left side"]

export function PlacementPanel({ placement, canUndo, design, As, A, placer, angles, meta, onFocusShot }: {
  placement: Placement; canUndo: boolean; design: DesignFile; As: number[]; A: number; placer: Placer
  angles: number[]; meta: SetMeta | null; onFocusShot: (n: number) => void
}) {
  const lim = limits(placement.zoom, design, As)
  const xMax = Math.round(lim.x * 100), yMax = Math.round(lim.y * 100)
  const zoom = Math.round(placement.zoom * 100), ox = Math.round(placement.ox * 100), oy = Math.round(placement.oy * 100)
  const nameOf = (n: number) => meta?.shots.find((x) => x.n === n)?.name ?? ""
  const chips = CHIPS.map((label) => ({ label, n: angles.find((n) => shotLabel(nameOf(n)) === label) })).filter((c) => c.n !== undefined)
  const level = sharpness(design.across, placement.zoom)
  return <div className="ms-panel">
    <section className="ms-sec">
      <span className="lbl">Size</span>
      <div className="ms-slider">
        {/* aria-disabled, not disabled: a button that disables itself on a key press would drop keyboard focus; at the limits these do nothing */}
        <IconButton className="sm" label="Smaller" icon={Icon.minus} aria-disabled={zoom <= 100 || undefined} onClick={() => placer.apply({ ...placement, zoom: placement.zoom - 0.05 })} />
        <Range min={100} max={250} value={zoom} label="Design size" valueText={`${zoom} percent`}
          onBegin={placer.begin} onEnd={placer.end} onSet={(v) => placer.set({ ...placement, zoom: v / 100 })} onApply={(v) => placer.apply({ ...placement, zoom: v / 100 })} />
        <IconButton className="sm" label="Bigger" icon={Icon.plus} aria-disabled={zoom >= 250 || undefined} onClick={() => placer.apply({ ...placement, zoom: placement.zoom + 0.05 })} />
        <output className="ms-val" aria-live="off">{zoom}%</output>
      </div>
    </section>
    <section className="ms-sec">
      <span className="lbl">Position</span>
      <div className="ms-slider plain">
        <span>Left / right</span>
        <Range min={-xMax} max={xMax} value={Math.max(-xMax, Math.min(xMax, ox))} label="Left / right" valueText={way(ox, "left", "right")} disabled={!xMax}
          onBegin={placer.begin} onEnd={placer.end} onSet={(v) => placer.set({ ...placement, ox: v / 100 })} onApply={(v) => placer.apply({ ...placement, ox: v / 100 })} />
        <output className="ms-val" aria-live="off">{signed(ox)}</output>
      </div>
      <div className="ms-slider plain">
        <span>Up / down</span>
        <Range min={-yMax} max={yMax} value={Math.max(-yMax, Math.min(yMax, oy))} label="Up / down" valueText={way(oy, "up", "down")} disabled={!yMax}
          onBegin={placer.begin} onEnd={placer.end} onSet={(v) => placer.set({ ...placement, oy: v / 100 })} onApply={(v) => placer.apply({ ...placement, oy: v / 100 })} />
        <output className="ms-val" aria-live="off">{signed(oy)}</output>
      </div>
      <p className="ms-slider-hint">{!xMax || !yMax ? "Make it bigger to move it this way." : ""}</p>
      <div className="row">
        <Button size="small" icon={Icon.centre} aria-disabled={(!placement.ox && !placement.oy) || undefined} onClick={() => placer.apply({ ...placement, ox: 0, oy: 0 })}>Centre</Button>
        <Button size="small" onClick={() => placer.apply(CENTERED)}>Reset</Button>
        <Button size="small" icon={Icon.undo} aria-disabled={!canUndo || undefined} onClick={placer.undo}>Undo</Button>
      </div>
    </section>
    <section className="ms-sec">
      <span className="lbl">What gets printed</span>
      <div className="ms-print">
        <PrintPreview design={design} placement={placement} A={A} placer={placer} />
        <div className="stack" style={{ gap: 8 }}>
          <p className="ms-small">The flat print, 105 × 168 mm. Drag here too.</p>
          <span className="row" style={{ gap: 8 }}><Meter level={level} /><span className="muted ms-small">Zooming in lowers sharpness.</span></span>
        </div>
      </div>
    </section>
    {chips.length > 0 && <section className="ms-sec">
      <span className="lbl">Check the tricky angles</span>
      <div className="row" style={{ gap: 8 }}>{chips.map((c) => <button key={c.label} type="button" className="chip" onClick={() => onFocusShot(c.n!)}>{c.label}</button>)}</div>
    </section>}
    <details className="ms-keys">
      <summary>Keyboard shortcuts</summary>
      <p>Arrows: move · Shift + arrows: move more · + / −: size · 0: reset · Ctrl + Z: undo · [ / ]: previous / next angle · F: full size · D: download</p>
    </details>
  </div>
}

// --- step 4 ------------------------------------------------------------------------------------------
export type Collections = { status: "loading" | "ready" | "error"; items: { id: string; title: string }[] }

function FieldBox({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {children}
    <small id={`${id}-msg`} className={error ? "field-error" : "ms-field-hint"}>{error || hint}</small>
  </div>
}

const SLUG_TEXT: Record<SlugState, string> = {
  idle: "", checking: "Checking…", free: "Available", taken: "Already used by another design. Try another URL.",
  invalid: "Use lowercase letters, numbers and dashes.", unknown: "Couldn't check right now. It is checked again when you publish.",
}

/** "Published", "Draft" or "Published and draft" across a design's products. */
export function designStatus(d: ExistingDesign) {
  const all = new Set(d.products.map((p) => p.status))
  return all.size > 1 ? "Published and draft" : all.has("published") ? "Published" : "Draft"
}

/** Update pictures: the existing design's own details, read-only; only its pictures change. */
function UpdateDetails({ s, existing, caseTypeName, onNewMode, onRetryExisting, onSubmit }: {
  s: State; existing: ExistingState; caseTypeName: string; onNewMode: () => void; onRetryExisting: () => void; onSubmit: () => void
}) {
  const d = s.details
  const ex = existing.status === "ready" ? existing.design : null
  const rows: [string, ReactNode][] = ex ? [
    ["Title", ex.name], ["URL", `/product/${d.slug}/`], ["Collection", ex.collection?.title ?? "None"], ["Status", designStatus(ex)],
  ] : []
  return <form className="ms-panel" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
    <div className="note ms-update-note" role="status">
      <p><strong>Update pictures</strong> of {ex ? `“${ex.name}”` : `/product/${d.slug}/`}.</p>
      <p className="ms-small">Only its {caseTypeName} pictures change, for the models you chose. Title, collection, description, status, stock, prices and variant IDs stay as they are.</p>
      <button type="button" className="linkbtn" onClick={onNewMode}>Make a new product instead</button>
    </div>
    {existing.status === "loading" && <p className="row muted ms-small"><span className="spin" aria-hidden />Loading the design…</p>}
    {existing.status === "error" && <div className="note error row" role="alert"><span>{existing.message}</span>
      <button type="button" className="linkbtn" onClick={onRetryExisting}>Try again</button></div>}
    {ex && <dl className="ms-sum">{rows.map(([label, value]) => <div key={label} className="ms-sum-row"><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <button type="submit" className="sr-only" tabIndex={-1}>Continue</button>
  </form>
}

/** Update pictures' existing design: GET /admin/designs/:slug. */
export type ExistingState = { status: "idle" } | { status: "loading" } | { status: "ready"; design: ExistingDesign } | { status: "error"; message: string }

export function DetailsForm({ s, slugState, collections, existing, caseTypeName, onPatch, onRetryCollections, onSubmit, onUpdateMode, onNewMode, onRetryExisting }: {
  s: State; slugState: SlugState; collections: Collections; existing: ExistingState; caseTypeName: string
  onPatch: (patch: Partial<Details>) => void; onRetryCollections: () => void; onSubmit: () => void
  /** the URL is taken: switch to updating that design's pictures; and back */
  onUpdateMode: () => void; onNewMode: () => void; onRetryExisting: () => void
}) {
  const d = s.details
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  if (d.mode === "update") return <UpdateDetails s={s} existing={existing} caseTypeName={caseTypeName} onNewMode={onNewMode} onRetryExisting={onRetryExisting} onSubmit={onSubmit} />
  const errs = fieldErrors(s, slugState)
  const show = (k: keyof typeof errs) => (s.showErrors || touched[k] ? errs[k] : undefined)
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }))
  const slugOpen = d.slugOpen || slugState === "invalid" || slugState === "taken" || Boolean(show("slug"))
  const slugError = show("slug")
  const isNew = d.collection === NEW_COLLECTION
  const exists = isNew && d.newCollection.trim() && collections.items.some((c) => slugify(c.title) === slugify(d.newCollection))
  const sorted = [...collections.items].sort((a, b) => a.title.localeCompare(b.title))
  const aria = (k: keyof typeof errs, id: string) => ({ "aria-invalid": show(k) ? true : undefined, "aria-describedby": `${id}-msg` })

  return <form className="ms-panel" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
    <FieldBox id="ms-f-name" label="Product title" hint="Customers see this. It is also the design's name." error={show("name")}>
      <input id="ms-f-name" className="input" value={d.name} maxLength={200} autoComplete="off" {...aria("name", "ms-f-name")}
        onChange={(e) => onPatch({ name: e.target.value, nameTouched: true })} onBlur={blur("name")} />
    </FieldBox>

    <div className="field">
      <label htmlFor={slugOpen ? "ms-f-slug" : undefined}>Product URL</label>
      {slugOpen
        ? <div className="ms-prefix"><span>/product/</span>
          <input id="ms-f-slug" className="input" value={d.slug} maxLength={150} autoComplete="off" spellCheck={false} {...aria("slug", "ms-f-slug")}
            onChange={(e) => onPatch({ slug: e.target.value, slugTouched: true, slugOpen: true })} onBlur={blur("slug")} /></div>
        : <div className="ms-url"><span>florayn.com/product/<b>{d.slug || "…"}</b>/</span>
          <button type="button" className="linkbtn" onClick={() => { onPatch({ slugOpen: true }); requestAnimationFrame(() => document.getElementById("ms-f-slug")?.focus()) }}>Change</button></div>}
      <p id="ms-f-slug-msg" className={`ms-slug-state${slugError || slugState === "taken" ? " is-taken" : slugState === "free" ? " is-free" : ""}`} aria-live="polite">
        {slugState === "checking" && !slugError && <span className="spin" aria-hidden />}
        {slugState === "free" && !slugError && Icon.check}
        {slugError && slugState !== "taken" && slugState !== "invalid" ? slugError : SLUG_TEXT[slugState]}
      </p>
      {slugState === "taken" && <div className="note row ms-update-offer"><span>This design already exists.</span>
        <button type="button" id="ms-update-mode" className="linkbtn" onClick={onUpdateMode}>Update its pictures instead</button></div>}
    </div>

    <FieldBox id={isNew ? "ms-f-newcol" : "ms-f-collection"} label={isNew ? "New collection name" : "Collection"} error={isNew ? show("newCollection") : undefined}
      hint={isNew ? (exists ? "That collection already exists. The product is added to it." : "A new collection is made when you publish.") : collections.status === "error" ? undefined : ""}>
      {isNew
        ? <input id="ms-f-newcol" className="input" value={d.newCollection} maxLength={200} placeholder="e.g. Spring Florals" autoFocus {...aria("newCollection", "ms-f-newcol")}
          onChange={(e) => onPatch({ newCollection: e.target.value })} onBlur={blur("newCollection")} />
        : <select id="ms-f-collection" className="select" value={d.collection} disabled={collections.status === "loading"} onChange={(e) => onPatch({ collection: e.target.value })}>
          {collections.status === "loading"
            ? <option value={d.collection}>Loading collections…</option>
            : <><option value="">No collection</option>{sorted.map((c) => <option key={c.id} value={c.title}>{c.title}</option>)}<option value={NEW_COLLECTION}>+ Create a new collection</option></>}
        </select>}
    </FieldBox>
    {isNew && <div><button type="button" className="linkbtn" onClick={() => {
      onPatch({ collection: "" })
      requestAnimationFrame(() => document.getElementById("ms-f-collection")?.focus()) // the select takes the input's place
    }}>Choose an existing one instead</button></div>}
    {!isNew && collections.status === "error" && <p className="note error row" role="alert">Couldn't load collections. <button type="button" className="linkbtn" onClick={onRetryCollections}>Retry</button></p>}

    <FieldBox id="ms-f-stock" label="Starting stock" hint="For new blank cases only. Stock that already exists is kept." error={show("stock")}>
      <input id="ms-f-stock" className="input" type="number" min={0} max={10000000} step={1} inputMode="numeric" value={d.stock} {...aria("stock", "ms-f-stock")}
        onChange={(e) => onPatch({ stock: e.target.value })} onBlur={blur("stock")} />
    </FieldBox>
    <FieldBox id="ms-f-desc" label="Description (optional)">
      <textarea id="ms-f-desc" className="textarea" rows={4} maxLength={20000} value={d.description} onChange={(e) => onPatch({ description: e.target.value })} />
    </FieldBox>
    <button type="submit" className="sr-only" tabIndex={-1}>Continue</button>
  </form>
}

/** Phone, Details step: a small picture of what is being made instead of the stage. */
export function MiniSummary({ bitmap, title, models, colour }: { bitmap: ImageBitmap | null; title: string; models: number; colour: string }) {
  return <div className="ms-mini">
    <span className="thumb">{bitmap ? <ShotCanvas bitmap={bitmap} /> : null}</span>
    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
      <strong className="ms-ellipsis">{title}</strong>
      <span className="muted ms-small">{plural(models, "model")} · {colour}</span>
    </span>
  </div>
}
