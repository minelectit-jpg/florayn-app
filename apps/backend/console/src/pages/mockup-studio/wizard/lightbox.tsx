// Mockup Studio > New product: one picture at full size (2400 px), Fit or 100%,
// with download and the phone share sheet (MOCKUP_STUDIO.md).
import { useEffect, useRef, useState, type KeyboardEvent } from "react"

import { downscale, shotTitle, type MockupSet, type Placement, type SetMeta } from "../../../mockup/layers"
import { shareReady } from "../../../mockup/zip"
import { Button, Icon, IconButton, Segmented, toast, Toaster } from "../../../ui"
import { cellKey, thumbBest, type Renderers } from "./engine"
import { placementKey } from "./state"

export type LightboxTarget = { device: string; colour: string; shots: number[]; index: number }
type Result = { bitmap: ImageBitmap; size: number }

export function Lightbox({ target, set, meta, full, model, r, placement, version, background, fileName, standIn, canShare, downloading, onIndex, onClose, onDownload }: {
  target: LightboxTarget; set: MockupSet; meta: SetMeta | null
  /** whether this colour's 2400 px layers are uploaded (false: 1200 straight away) */
  full: boolean | null
  model: string; r: Renderers; placement: Placement; version: number
  /** downloads' background, for the file Share hands over */
  background: "white" | "transparent"
  /** the download name of a shot at a size */
  fileName: (shot: number, size: number) => string
  /** the stage's picture when it shows this exact one */
  standIn: (key: string) => ImageBitmap | null
  canShare: boolean; downloading: boolean
  onIndex: (i: number) => void; onClose: () => void; onDownload: (shot: number) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)
  const results = useRef(new Map<string, Result>())
  const alive = useRef(false)
  const [mode, setMode] = useState<"fit" | "actual">("fit")
  const [state, setState] = useState<{ key: string; status: "loading" | "done" | "error"; size: number; error: string }>({ key: "", status: "loading", size: 0, error: "" })
  const [shown, setShown] = useState<ImageBitmap | null>(null)
  const [fit, setFit] = useState(0)
  const [nonce, setNonce] = useState(0)
  // the PNG Share hands over, made before the tap (file null: it could not be made)
  const [prepared, setPrepared] = useState<{ key: string; file: File | null } | null>(null)
  const lastTap = useRef(0)
  const shot = target.shots[target.index]
  const cell = cellKey(set.device, target.colour, shot, version)
  const pk = placementKey(placement)
  const key = `${cell}|${pk}`
  const shareKey = `${key}|${background}`
  const cur = useRef(key)
  cur.current = key
  const name = meta?.shots.find((x) => x.n === shot)?.name ?? String(shot)
  const title = `${model} · ${target.colour} · ${shot}. ${shotTitle(name)}`
  // 2400 px, or 1200 at once where 2400 is known not to be uploaded (the worker falls back on its own otherwise)
  const big = full !== false
  const job = { set, colour: target.colour, shot, size: big ? 2400 : 1200, width: big ? r.hq : Math.min(r.hq, 3072), placement }

  useEffect(() => {
    alive.current = true // StrictMode runs this twice; the ref keeps false from the first cleanup otherwise
    const d = dialog.current!
    const c = canvas.current // captured now: the ref is already null when the cleanup runs
    opener.current = document.activeElement
    if (!d.open) d.showModal()
    return () => {
      alive.current = false
      r.detail.bump("lightbox") // drops a 2400 px job still waiting; one already running is closed when it lands
      r.detail.bump("share")
      if (d.open) d.close()
      const back = opener.current as HTMLElement | null
      requestAnimationFrame(() => back?.focus?.())
      for (const res of results.current.values()) res.bitmap.close()
      results.current.clear()
      if (c) c.width = c.height = 0 // the 100% view is a 2400 px (23 MB) backing store
    }
  }, [])

  // the view's size for Fit
  useEffect(() => {
    const el = view.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const s = Math.floor(Math.min(e.contentRect.width, e.contentRect.height))
      if (s > 0) setFit(s)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // the best picture at hand at once, then the 2400 px one
  useEffect(() => {
    const hit = results.current.get(key)
    if (hit) {
      results.current.delete(key); results.current.set(key, hit)
      setShown(hit.bitmap)
      setState({ key, status: "done", size: hit.size, error: "" })
      return
    }
    const quick = standIn(key) ?? thumbBest(cell, pk)
    if (quick) setShown(quick)
    setState({ key, status: "loading", size: 0, error: "" })
    const ep = r.epoch.current
    r.detail.bitmap({ ...job, lane: "lightbox", prio: 0 }, r.detail.bump("lightbox")).then((res) => {
      if (!res) return
      if (!alive.current || ep !== r.epoch.current) { res.bitmap.close(); return }
      results.current.set(key, res)
      while (results.current.size > 2) {
        const [oldKey, old] = results.current.entries().next().value!
        results.current.delete(oldKey)
        old.bitmap.close()
      }
      if (cur.current === key) { setShown(res.bitmap); setState({ key, status: "done", size: res.size, error: "" }) }
    }, (e) => {
      if (e?.name !== "AbortError" && alive.current && cur.current === key) setState({ key, status: "error", size: 0, error: String(e?.message ?? e) })
    })
  }, [key, nonce])

  // Share must open the sheet within the tap's user activation, so its PNG is made before the tap: once the
  // full-size picture is done (the layers and design are cached by then), on its own lane, behind the stage's jobs
  useEffect(() => {
    setPrepared((p) => (p && p.key === shareKey ? p : null))
    if (!canShare || state.key !== key || state.status !== "done") return
    let live = true
    const ep = r.epoch.current
    r.detail.png({ ...job, background, lane: "share", prio: 1 }, r.detail.bump("share")).then((res) => {
      if (!live || !alive.current || ep !== r.epoch.current) return
      setPrepared({ key: shareKey, file: new File([res.blob], fileName(shot, res.size), { type: "image/png" }) })
    }, (e) => {
      if (live && alive.current && e?.name !== "AbortError") setPrepared({ key: shareKey, file: null })
    })
    return () => { live = false; r.detail.bump("share") } // another angle or background: drop this one
  }, [shareKey, state.key, state.status, canShare])
  const shareFile = prepared?.key === shareKey ? prepared.file : undefined
  const shareState = shareFile ? "ready" : shareFile === null || state.status === "error" ? "off" : "preparing"
  // nothing may be awaited before navigator.share: it runs synchronously inside the tap
  const share = () => { if (shareFile) shareReady(shareFile).catch(() => toast("Sharing failed. Use Download instead.", "error")) }

  // draw: Fit at the view's device pixels, 100% at the picture's own pixels. It never throws: iOS hands out no
  // context once its canvas memory is used up.
  useEffect(() => {
    const c = canvas.current
    if (!c || !shown || !shown.width) return
    const dpr = window.devicePixelRatio || 1
    if (mode === "actual") {
      if (c.width !== shown.width) { c.width = shown.width; c.height = shown.height }
      c.style.width = `${shown.width / dpr}px`
      c.style.height = `${shown.height / dpr}px`
      const g = c.getContext("2d")
      // no memory for a 2400 px canvas: free it and show Fit
      if (!g) { c.width = c.height = 0; setMode("fit"); return }
      g.clearRect(0, 0, c.width, c.height)
      g.drawImage(shown, 0, 0)
      return
    }
    if (!fit) return
    const px = Math.round(fit * Math.min(dpr, 3))
    c.width = px; c.height = px
    c.style.width = `${fit}px`
    c.style.height = `${fit}px`
    const g = c.getContext("2d")
    if (!g) return
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = "high"
    let drawn = false
    if (shown.width > px * 2) {
      try {
        const small = downscale(shown, px, px)
        g.drawImage(small, 0, 0)
        small.width = small.height = 0
        drawn = true
      } catch { /* out of memory for the halving steps: one direct (softer) draw needs no extra canvas */ }
    }
    if (!drawn) g.drawImage(shown, 0, 0, px, px)
  }, [shown, mode, fit])

  const go = (d: number) => onIndex((target.index + d + target.shots.length) % target.shots.length)
  const toggle = () => setMode((m) => (m === "fit" ? "actual" : "fit"))
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if ((e.target as HTMLElement).closest("input, select, textarea")) return
    // at 100% the focused view pans with the native arrow keys; the bottom-bar buttons still change the angle
    const panning = mode === "actual" && e.target === view.current
    if (e.key === "ArrowLeft" && !panning) { e.preventDefault(); go(-1) }
    else if (e.key === "ArrowRight" && !panning) { e.preventDefault(); go(1) }
    else if (e.key === "0") setMode("fit")
    else if (e.key === "1") setMode("actual")
    else if (e.key === "d" || e.key === "D") onDownload(shot)
  }

  const pill = state.status === "loading"
    ? <span className="ms-pill"><span className="spin" aria-hidden />Making the full-size picture…</span>
    : state.status === "error"
      ? <span className="ms-pill is-bad-lb">Couldn't make the full-size picture. <button type="button" className="linkbtn" onClick={() => setNonce((n) => n + 1)}>Try again</button></span>
      : <span className="ms-pill">{state.size >= 2400 ? "2400 × 2400 px" : `${state.size} px · 2400 not uploaded for ${target.colour} yet`}</span>

  return <dialog ref={dialog} className="ms-lb" aria-labelledby="ms-lb-title" onCancel={(e) => { e.preventDefault(); onClose() }} onKeyDown={onKeyDown}>
    <div className="ms-lb-top">
      <h2 id="ms-lb-title" className="ms-lb-title">{title}</h2>
      {/* one of the two pill slots shows at a time (top bar here, over the picture on phones); both stay mounted */}
      <span className="hide-phone" role="status">{pill}</span>
      <span className="hide-phone"><Segmented<"fit" | "actual"> label="Zoom" value={mode} onChange={setMode} options={[["fit", "Fit"], ["actual", "100%"]]} /></span>
      <Button className="hide-phone" size="small" icon={Icon.download} loading={downloading} onClick={() => onDownload(shot)}>Download PNG</Button>
      {canShare && <Button className="hide-phone" size="small" icon={Icon.share} loading={shareState === "preparing"} disabled={shareState === "off"}
        title={shareState === "preparing" ? "Preparing the picture to share…" : undefined} onClick={share}>{shareState === "preparing" ? "Preparing…" : "Share"}</Button>}
      <IconButton label="Close" icon={Icon.close} onClick={onClose} />
    </div>
    <div ref={view} className={`ms-lb-view${mode === "actual" ? " is-actual" : ""}`}
      tabIndex={mode === "actual" ? 0 : -1} role="group" aria-label={mode === "actual" ? "Full-size picture. Arrow keys pan." : "Picture"}
      onDoubleClick={toggle}
      onPointerUp={(e) => {
        if (e.pointerType !== "touch") return
        const now = Date.now()
        if (now - lastTap.current < 300) { lastTap.current = 0; toggle() } else lastTap.current = now
      }}>
      <canvas ref={canvas} role="img" aria-label={`${title}, full size`} />
      <span className="ms-lb-pill-phone" role="status">{pill}</span>
    </div>
    <div className="ms-lb-bottom">
      <IconButton label="Previous angle" icon={Icon.chevronLeft} disabled={target.shots.length < 2} onClick={() => go(-1)} />
      <span className="ms-num ms-lb-count">{target.index + 1} / {target.shots.length}</span>
      <IconButton label="Next angle" icon={Icon.chevronRight} disabled={target.shots.length < 2} onClick={() => go(1)} />
      <span className="ms-lb-phone-tools">
        <IconButton label="Download PNG" icon={Icon.download} loading={downloading} onClick={() => onDownload(shot)} />
        {canShare && <IconButton label={shareState === "preparing" ? "Share (preparing the picture)" : "Share"} icon={Icon.share}
          loading={shareState === "preparing"} disabled={shareState === "off"} onClick={share} />}
      </span>
    </div>
    {/* the page's toasts are behind this modal and inert: this one shows them while it is open */}
    <Toaster />
  </dialog>
}
