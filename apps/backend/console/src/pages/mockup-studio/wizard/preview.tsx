// Mockup Studio > New product: the stage (the big picture you can drag on), the
// filmstrip of angles and the phone colour swatches (MOCKUP_STUDIO.md).
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from "react"

import { downscale, shotLabel, shotTitle, type MockupSet, type Placement, type SetMeta, type UvPick } from "../../../mockup/layers"
import { Button, Icon, IconButton, Skeleton } from "../../../ui"
import type { ShotResult, StageState } from "./engine"
import { clamp, dotColour, zoomAbout, type MetaState, type StepId } from "./state"

/** One picture drawn at the box's device pixels (contained, centred, high-quality smoothing). Never blanked. */
export function ShotCanvas({ bitmap, stale, label, className }: { bitmap: ImageBitmap | null | undefined; stale?: boolean; label?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState<[number, number]>([0, 0])
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (!width || !height) return
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      setBox([Math.round(width * dpr), Math.round(height * dpr)])
    })
    ro.observe(c)
    return () => {
      ro.disconnect()
      c.width = c.height = 0 // release the backing store now, not at the next GC (iOS counts it against its canvas cap)
    }
  }, [])
  useEffect(() => {
    const c = ref.current
    if (!c || !bitmap || !box[0]) return
    const id = requestAnimationFrame(() => {
      if (!bitmap.width) return // closed: keep the old pixels
      if (c.width !== box[0] || c.height !== box[1]) { c.width = box[0]; c.height = box[1] }
      const g = c.getContext("2d")
      if (!g) return
      const s = Math.min(box[0] / bitmap.width, box[1] / bitmap.height)
      const dw = Math.round(bitmap.width * s), dh = Math.round(bitmap.height * s)
      let src: CanvasImageSource = bitmap
      let small: OffscreenCanvas | null = null
      if (s < 0.5) { small = downscale(bitmap, dw, dh); src = small }
      g.clearRect(0, 0, c.width, c.height)
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = "high"
      g.drawImage(src, (box[0] - dw) / 2, (box[1] - dh) / 2, dw, dh)
      if (small) small.width = small.height = 0
    })
    return () => cancelAnimationFrame(id)
  }, [bitmap, box[0], box[1]])
  return <canvas ref={ref} className={[stale ? "is-stale" : "", className ?? ""].join(" ").trim() || undefined} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

/** A thumbnail slot: picture, error icon or skeleton. A click on the error icon retries and goes no further. */
export function Thumb({ result, label, onRetry }: { result: ShotResult | undefined; label?: string; onRetry?: () => void }) {
  if (result && "bitmap" in result) return <ShotCanvas bitmap={result.bitmap} stale={result.stale} label={label} />
  if (result && "error" in result) {
    return <span className="ms-thumb-error" title={result.error} role="img" aria-label={result.error}
      onClick={onRetry ? (e) => { e.preventDefault(); e.stopPropagation(); onRetry() } : undefined}>{Icon.alert}</span>
  }
  return <Skeleton />
}

/** Drag-over stays on while the pointer moves over the drop target's own children. */
export const leaveDrop = (set: (over: boolean) => void) => (e: DragEvent<HTMLElement>) => {
  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set(false)
}

/** One phone colour to show (the stage's chip row): radio chips over colours (default: every colour of the set). */
export function Swatches({ set, colours, value, model, label, onChange, disabled }: {
  set: MockupSet; colours?: string[]; value: string; model: string; label?: string; onChange: (colour: string) => void; disabled?: boolean
}) {
  const id = useId()
  const list = colours ?? set.colours
  if (list.length < 2) return null
  return <div className="ms-swatches" role="radiogroup" aria-label={label ?? `Phone colour for ${model}`}>
    {list.map((c) => <label key={c} className="ms-swatch" title={c} style={{ "--sw": dotColour(set, c) } as CSSProperties}>
      <input type="radio" className="sr-only" name={`sw${id}`} checked={c === value} disabled={disabled} aria-label={c} onChange={() => onChange(c)} /><i />
    </label>)}
  </div>
}

/**
 * The phone colours to make pictures in (model cards): checkbox chips, a ring when ticked, a "Main" pip on the main
 * colour. The last ticked chip is disabled, so a chosen model always has a colour.
 */
export function ColourChecks({ set, on, colours, main, model, disabled, onToggle }: {
  set: MockupSet; on: boolean; colours: string[]; main: string; model: string; disabled?: boolean; onToggle: (colour: string) => void
}) {
  if (set.colours.length < 2) return null
  return <div className="ms-swatches is-multi" role="group" aria-label={`Phone colours for ${model}`}>
    {set.colours.map((c) => {
      const ticked = on && colours.includes(c)
      const isMain = on && c === main
      const locked = ticked && colours.length === 1
      return <label key={c} className="ms-swatch" title={locked ? `${c} (at least one colour stays ticked)` : c} style={{ "--sw": dotColour(set, c) } as CSSProperties}>
        <input type="checkbox" className="sr-only" checked={ticked} disabled={disabled || locked} aria-label={`${c}${isMain ? ", main colour" : ""}`} onChange={() => onToggle(c)} />
        <i />{isMain && <b className="ms-swatch-main" aria-hidden>Main</b>}
      </label>
    })}
  </div>
}

export function Filmstrip({ meta, angles, gallery, shotNow, results, count, onSelect, onRetry }: {
  meta: SetMeta | null; angles: number[]; gallery: number[]; shotNow: number; results: Record<string, ShotResult>; count: number
  onSelect: (n: number) => void; onRetry: (slot: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector("input:checked")?.closest("label")?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [shotNow, meta])
  if (!meta) {
    return <div className="ms-film" role="radiogroup" aria-label="Angle" aria-busy="true">
      {Array.from({ length: count }, (_, i) => <span key={i} className="ms-film-item"><span className="ms-film-thumb"><Skeleton /></span><span className="ms-film-label" /></span>)}
    </div>
  }
  return <div ref={ref} className="ms-film" role="radiogroup" aria-label="Angle">
    {angles.map((n) => {
      const name = meta.shots.find((x) => x.n === n)?.name ?? String(n)
      const r = results[String(n)]
      return <label key={n} className="ms-film-item" title={name}>
        <input type="radio" className="sr-only" name="ms-angle" checked={n === shotNow} aria-label={`${n}. ${shotTitle(name)}${gallery.includes(n) ? "" : ", not in shop"}`}
          onChange={() => onSelect(n)} onClick={() => { if (r && "error" in r) onRetry(String(n)) }} />
        <span className="ms-film-thumb"><Thumb result={r} /><span className="n">{n}</span>{!gallery.includes(n) && <span className="ms-tag">Not in shop</span>}</span>
        <span className="ms-film-label">{shotLabel(name)}</span>
      </label>
    })}
  </div>
}

export type Placer = {
  /** clamps (the design always covers the print) and returns the placement used */
  set(p: Placement): Placement
  /** a drag, pinch, wheel or slider gesture starts: one undo entry for all of it, Live pictures until it ends */
  begin(): void
  end(): void
  /** one step (keys, buttons): its own undo entry */
  apply(p: Placement): void
  undo(): void
  reset(): void
}

type Pt = { x: number; y: number }
type UV = { u: number; v: number }
type Gesture =
  | { kind: "drag"; p: Placement; t0: UV; last: Pt; lastT: UV; virtual: boolean; moved: boolean }
  | { kind: "pinch"; p: Placement; d0: number; anchor: { x: number; y: number } | null }

export type PreviewProps = {
  mode: "placeholder" | "static" | "editable"
  step: StepId
  list: MockupSet[]
  focusSet: MockupSet | null
  /** the colour the stage shows */
  colour: string
  /** the colours its chip row switches between: the focused model's ticked ones (all of a model not chosen) */
  stageColours: string[]
  deviceName: (slug: string) => string
  meta: SetMeta | null
  metaState: MetaState | undefined
  angles: number[]
  gallery: number[]
  shotNow: number
  stage: StageState
  film: Record<string, ShotResult>
  onFilmRetry: (slot: string) => void
  uvPick: UvPick | null
  placement: Placement
  placer: Placer
  hasDesign: boolean
  coarse: boolean
  hintSeen: boolean
  onHintSeen: () => void
  onFocus: (f: { device?: string; shot?: number }) => void
  onColour: (device: string, colour: string) => void
  onOpenFull: () => void
  onDownload: () => void
  downloading: boolean
  onChooseFile: () => void
  onDropFile: (f: File) => void
  onRetryMeta: () => void
  stageRef: (el: HTMLElement | null) => void
}

const QUALITY: Record<string, string> = { preview: "Preview", sharpening: "Sharpening…", full: "Full quality" }

export function Preview(props: PreviewProps) {
  const { mode, step, focusSet, colour, meta, metaState, angles, shotNow, stage, uvPick, placer, hasDesign, coarse, deviceName, stageRef } = props
  const previewOn = useId()
  const model = focusSet ? deviceName(focusSet.device) : ""
  const shotName = meta?.shots.find((x) => x.n === shotNow)?.name ?? ""
  const angle = shotTitle(shotName)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [over, setOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fullGone, setFullGone] = useState(false)
  const latest = useRef(props)
  latest.current = props
  const placeNow = useRef(props.placement)
  placeNow.current = props.placement
  const pointers = useRef(new Map<number, Pt>())
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef(0)
  const editable = mode === "editable"
  const canDrag = Boolean(uvPick && uvPick.print >= 400)

  // "Full quality" fades 2 s after it appears and comes back on the next change
  useEffect(() => {
    setFullGone(false)
    if (stage.quality !== "full") return
    const t = setTimeout(() => setFullGone(true), 2000)
    return () => clearTimeout(t)
  }, [stage.quality, stage.key])

  // stable, so the stage is not detached and re-attached (two extra renders of the page) on every commit
  const ref = useCallback((node: HTMLDivElement | null) => { setEl(node); stageRef(node) }, [stageRef])

  // --- pointer maths (MOCKUP_STUDIO.md: the design point under the finger stays under it) ---------
  const toShot = (pt: Pt): Pt | null => {
    const pick = latest.current.uvPick
    if (!el || !pick) return null
    const r = el.getBoundingClientRect()
    return { x: ((pt.x - r.left) / r.width) * pick.w, y: ((pt.y - r.top) / r.height) * pick.h }
  }
  const uvAt = (p: Pt | null): UV | null => {
    const pick = latest.current.uvPick
    if (!p || !pick) return null
    const x = Math.floor(p.x), y = Math.floor(p.y)
    if (x < 0 || y < 0 || x >= pick.w || y >= pick.h) return null
    const i = y * pick.w + x
    return pick.M[i] >= 128 ? { u: pick.U[i], v: pick.V[i] } : null
  }
  const nearestInRow = (p: Pt | null): UV | null => {
    const pick = latest.current.uvPick
    if (!p || !pick) return null
    const y = clamp(Math.floor(p.y), 0, pick.h - 1), x0 = clamp(Math.floor(p.x), 0, pick.w - 1)
    for (let d = 1; d < pick.w; d++) {
      for (const x of [x0 - d, x0 + d]) {
        if (x < 0 || x >= pick.w) continue
        const i = y * pick.w + x
        if (pick.M[i] >= 128) return { u: pick.U[i], v: pick.V[i] }
      }
    }
    return null
  }
  const startDrag = (pt: Pt) => {
    const pos = toShot(pt) ?? { x: 0, y: 0 }
    const real = uvAt(pos) ?? nearestInRow(pos)
    const t0 = real ?? { u: 0, v: 0 }
    gesture.current = { kind: "drag", p: placeNow.current, t0, last: pos, lastT: t0, virtual: !real, moved: false }
  }
  const startPinch = (a: Pt, b: Pt) => {
    const t = uvAt(toShot({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }))
    gesture.current = { kind: "pinch", p: placeNow.current, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor: t ? { x: t.u, y: 1 - t.v } : null }
  }
  const restart = () => {
    const pts = [...pointers.current.values()]
    if (pts.length >= 2) startPinch(pts[0], pts[1])
    else if (pts.length === 1 && canDrag) startDrag(pts[0])
    else gesture.current = null
  }
  const apply = () => {
    frame.current = 0
    const g = gesture.current, pick = latest.current.uvPick
    const pts = [...pointers.current.values()]
    if (!g || !pick) return
    if (g.kind === "drag" && pts.length === 1) {
      const pos = toShot(pts[0])
      if (!pos) return
      const [j0, j1, j2, j3] = pick.J
      const dx = pos.x - g.last.x, dy = pos.y - g.last.y
      const t = (g.virtual ? null : uvAt(pos)) ?? { u: g.lastT.u + j0 * dx + j1 * dy, v: g.lastT.v + j2 * dx + j3 * dy }
      g.last = pos; g.lastT = t
      if (Math.abs(t.u - g.t0.u) + Math.abs(t.v - g.t0.v) > 1e-4) g.moved = true
      placeNow.current = placer.set({ ...g.p, ox: g.p.ox + (t.u - g.t0.u), oy: g.p.oy - (t.v - g.t0.v) })
    } else if (g.kind === "pinch" && pts.length >= 2) {
      const z = clamp((g.p.zoom * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.d0, 1, 2.5)
      placeNow.current = placer.set(zoomAbout(g.p, z, g.anchor))
    }
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!editable || (e.target as HTMLElement).closest("button") || (e.pointerType === "mouse" && e.button !== 0)) return
    if (!pointers.current.size && !canDrag && e.pointerType === "mouse") return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) { placer.begin(); setDragging(true) }
    restart()
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    if (frame.current) { cancelAnimationFrame(frame.current); apply() }
    const g = gesture.current
    if (g?.kind === "drag" && g.moved) props.onHintSeen()
    pointers.current.delete(e.pointerId)
    if (!pointers.current.size) { gesture.current = null; setDragging(false); placer.end() }
    else restart()
  }

  // the wheel needs a non-passive listener to keep the page from scrolling
  useEffect(() => {
    if (!el || !editable) return
    let timer = 0, on = false
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const L = latest.current
      if (!on) { on = true; L.placer.begin() }
      const p = placeNow.current
      const z = clamp(p.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (e.ctrlKey ? 0.01 : 0.0015)), 1, 2.5)
      const t = uvAt(toShot({ x: e.clientX, y: e.clientY }))
      placeNow.current = L.placer.set(zoomAbout(p, z, t ? { x: t.u, y: 1 - t.v } : null))
      clearTimeout(timer)
      timer = window.setTimeout(() => { on = false; latest.current.placer.end() }, 250)
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", wheel)
      clearTimeout(timer)
      if (on) latest.current.placer.end()
    }
  }, [el, editable])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editable || e.target !== e.currentTarget) return
    const p = placeNow.current, d = e.shiftKey ? 0.05 : 0.01
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); placer.undo(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    let next: Placement | null = null
    if (e.key === "ArrowLeft") next = { ...p, ox: p.ox - d }
    else if (e.key === "ArrowRight") next = { ...p, ox: p.ox + d }
    else if (e.key === "ArrowUp") next = { ...p, oy: p.oy - d }
    else if (e.key === "ArrowDown") next = { ...p, oy: p.oy + d }
    else if (e.key === "+" || e.key === "=") next = { ...p, zoom: p.zoom + 0.05 }
    else if (e.key === "-" || e.key === "_") next = { ...p, zoom: p.zoom - 0.05 }
    else if (e.key === "0") { e.preventDefault(); placer.reset(); return }
    if (!next) return
    e.preventDefault()
    placer.apply(next)
  }

  // drop a file on the stage (Design step)
  const dropOK = step === "design"
  const onDragOver = (e: DragEvent) => { if (!dropOK || !e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setOver(true) }
  const onDrop = (e: DragEvent) => {
    if (!dropOK) return
    e.preventDefault(); setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) props.onDropFile(f)
  }

  const list = props.list
  const stepAround = (dir: 1 | -1) => {
    if (!angles.length) return
    const i = angles.indexOf(shotNow)
    props.onFocus({ shot: angles[(i + dir + angles.length) % angles.length] })
  }
  const cls = ["ms-stage", editable ? "is-editable" : mode === "static" ? "is-static" : "", dragging ? "is-dragging" : "", over ? "is-over" : ""].filter(Boolean).join(" ")
  const quality = stage.error && stage.bitmap ? null : QUALITY[stage.quality]
  const loading = !meta && metaState?.status !== "error"
  const label = mode === "placeholder" ? "Your design appears here" : `${model} in ${colour}, ${shotNow}. ${angle}`

  return <div className="ms-stage-col">
    <div className="ms-stage-head">
      {list.length > 1 && focusSet
        ? <label className="ms-preview-on"><span className="muted" id={previewOn}>Preview on</span>
          <select className="select sm" aria-labelledby={previewOn} value={focusSet.device} onChange={(e) => props.onFocus({ device: e.target.value })}>
            {list.map((s) => <option key={s.device} value={s.device}>{deviceName(s.device)}</option>)}
          </select></label>
        : <strong className="ms-stage-model">{model}</strong>}
      {focusSet && <div className="ms-stage-colour">
        <Swatches set={focusSet} colours={props.stageColours} value={colour} model={model} label={`Phone colour shown for ${model}`} onChange={(c) => props.onColour(focusSet.device, c)} />
        <span className="muted">{colour}</span>
      </div>}
    </div>
    <div className={`ms-stage-wrap${hasDesign ? "" : " no-film"}`}>
      <div ref={ref} className={cls}
        role={editable ? "application" : undefined} aria-roledescription={editable ? "design placement" : undefined}
        aria-label={editable ? `Design position on ${model}, ${angle}` : undefined} aria-describedby={editable ? "ms-stage-desc" : undefined}
        tabIndex={editable ? 0 : undefined}
        onClick={(e) => { if (mode === "static" && hasDesign && !(e.target as HTMLElement).closest("button")) props.onOpenFull() }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown} onDragOver={onDragOver} onDragLeave={leaveDrop(setOver)} onDrop={onDrop}>
        {stage.bitmap ? <ShotCanvas bitmap={stage.bitmap} label={editable ? undefined : label} /> : <Skeleton />}
        {loading && focusSet && <span className="ms-pill q"><span className="spin" aria-hidden />Loading {model} mockups…</span>}
        {!loading && quality && meta && <span className={`ms-pill q${stage.quality === "full" ? " is-full" : ""}${stage.quality === "full" && fullGone ? " is-gone" : ""}`}
          title={`Made from the ${stage.size || 600} px renders at your screen's sharpness. Open full size to see 2400 px.`}>
          {stage.quality === "sharpening" && <span className="spin" aria-hidden />}{quality}</span>}
        {stage.error && stage.bitmap && <button type="button" className="ms-pill q is-bad" onClick={stage.retry}>Couldn't update · Try again</button>}
        {meta && shotName && <span className="ms-pill angle" title={shotName}>{shotNow} · {shotLabel(shotName)}</span>}
        {hasDesign && meta && angles.length > 1 && <>
          <IconButton className="glass ms-nav prev" label="Previous angle" icon={Icon.chevronLeft} onClick={() => stepAround(-1)} />
          <IconButton className="glass ms-nav next" label="Next angle" icon={Icon.chevronRight} onClick={() => stepAround(1)} />
        </>}
        {hasDesign && meta && <div className="ms-tools">
          <IconButton className="glass" label="View full size" icon={Icon.expand} onClick={props.onOpenFull} />
          <IconButton className="glass" label="Download this picture (PNG)" icon={Icon.download} loading={props.downloading} onClick={props.onDownload} />
        </div>}
        {editable && meta && (!props.hintSeen || !canDrag) && <span className="ms-pill hint">
          {uvPick && !canDrag ? "This angle shows little of the print. Drag on Front or a side." : coarse ? "Drag to move · Pinch to zoom" : "Drag to move · Scroll to zoom"}</span>}
        {mode === "placeholder" && step === "design" && <div className="ms-drop">
          <div className="ms-drop-card">
            <span className="ms-dropzone-icon">{Icon.upload}</span>
            <strong>{over ? "Drop to use this design" : "Drop your design here"}</strong>
            <Button variant="primary" size="small" onClick={props.onChooseFile}>Choose file</Button>
            <span className="muted ms-small">PNG, JPG or WebP · portrait 5 : 8 · 3000 px wide or more for sharp close-ups</span>
          </div>
        </div>}
        {!stage.bitmap && (stage.error || metaState?.status === "error") && <div className="ms-stage-error" role="alert">
          <strong>Couldn't show this picture</strong>
          <p className="muted">{stage.error || (metaState?.status === "error" ? metaState.message : "")}</p>
          <Button onClick={() => (stage.error ? stage.retry() : props.onRetryMeta())}>Try again</Button>
        </div>}
      </div>
      {hasDesign && <Filmstrip meta={meta} angles={angles} gallery={props.gallery} shotNow={shotNow} results={props.film} count={props.gallery.length}
        onSelect={(n) => props.onFocus({ shot: n })} onRetry={props.onFilmRetry} />}
    </div>
    {editable && <p id="ms-stage-desc" className="sr-only">Drag to move the design. Scroll or pinch to zoom. Arrow keys move it, plus and minus change its size, 0 resets.</p>}
  </div>
}
