// Mockup Studio > New product: a five-step wizard from one flat design to a
// Product Manager design product, draft or published (MOCKUP_STUDIO.md). The
// pictures are made in Web Workers; downloads are lossless 2400 px PNGs, and only
// the shop images are compressed, when they are uploaded.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react"

import { api } from "../../api"
import { designScale, rendererOptions, type Renderer } from "../../mockup/client"
import { A_DEFAULT, downscale, isLowMemory, loadMeta, MAX_CANVAS_PX, shotTitle, type MockupSet, type Placement, type Settings } from "../../mockup/layers"
import { canShareFiles, saveBlob } from "../../mockup/zip"
import { Button, Icon, slugify, toast, useLeaveGuard } from "../../ui"
import { cellKey, useBoxOut, useDevicePx, useMetas, useRenderers, useShots, useSlugCheck, useStage, useUvPick, type ShotItem } from "./wizard/engine"
import { downloadShots, publishProduct, Stopped, Taken, type JobState, type ZipItem } from "./wizard/export"
import { Lightbox, type LightboxTarget } from "./wizard/lightbox"
import { Preview, type Placer, type PreviewProps } from "./wizard/preview"
import { anglesOf, DoneScreen, DownloadCard, PublishCard, ReviewSheet, SummaryCard, type Done, type PngStats, type PublishError, type ReviewModel } from "./wizard/review"
import {
  across, allZipName, baseName, blockedBy, clampPlacement, entryName, fieldErrors, initialState, modelZipName, NEW_COLLECTION,
  placementKey, plural, pngName, reducer, slugValid, STEPS, stepErrors, stepIndex, type StepId,
} from "./wizard/state"
import { DesignPanel, DetailsForm, EmptyModels, MiniSummary, ModelsStep, PlacementPanel, StepHead, way, type Collections } from "./wizard/steps"

export type Device = { slug: string; name: string; family: string; is_active: boolean }

const DIRTY_MSG = "Leave New product? Your design and choices will be lost."
const JOB_MSG = "Pictures are still being made. If you leave now, nothing will be finished. Leave anyway?"
const STAGE_STEPS: StepId[] = ["design", "placement", "details"]
const MAX_BYTES = 60e6
const MAX_SIDE = 12000

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [query])
  return match
}

// a control swapped out from under the keyboard leaves focus on <body>: hand it to the one that took its place
const refocus = (id: string) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const a = document.activeElement
  if (!a || a === document.body || !a.isConnected) document.getElementById(id)?.focus()
}))
// a focused slider speaks its own value: no second announcement
const rangeFocused = () => Boolean((document.activeElement as HTMLElement | null)?.matches?.("input[type=range]"))

function Stepper({ step, reached, errors, busy, onGo }: { step: StepId; reached: number; errors: Partial<Record<StepId, string>>; busy: boolean; onGo: (s: StepId) => void }) {
  const cur = stepIndex(step)
  return <nav className="ms-steps" aria-label="New product steps"><ol>
    {STEPS.map((st, i) => {
      const blocked = blockedBy(errors, i) !== null
      const done = i !== cur && i < STEPS.length - 1 && (i < cur || i <= reached) && !errors[st.id] && !blocked
      const disabled = busy || (i !== cur && blocked)
      return <li key={st.id} className={i === cur ? "is-current" : done ? "is-done" : "is-todo"}>
        <button type="button" className="ms-step" aria-current={i === cur ? "step" : undefined} aria-disabled={disabled || undefined}
          aria-label={`Step ${i + 1} of 5, ${st.label}${done ? ", done" : ""}`}
          title={busy ? "Wait until the pictures are made." : disabled ? "Finish the earlier steps first." : undefined}
          onClick={() => { if (!disabled && i !== cur) onGo(st.id) }}>
          <span className="ms-dot">{done ? Icon.check : i + 1}</span><span className="ms-step-label">{st.label}</span>
        </button>
        {i < STEPS.length - 1 && <span className="ms-line" aria-hidden><i /></span>}
      </li>
    })}
  </ol></nav>
}

type Props = { settings: Settings; devices: Device[]; active: boolean; onOpenSets: () => void; onOpenSettings: () => void }

export default function NewProduct({ settings, devices, active, onOpenSets, onOpenSettings }: Props) {
  const lowMemory = useMemo(isLowMemory, [])
  const coarse = useMedia("(pointer: coarse)")
  const phone = useMedia("(max-width: 860px)")
  const [s, dispatch] = useReducer(reducer, undefined, initialState)
  const [R, ready] = useRenderers(lowMemory)
  const sets = useMemo(() => settings.sets.filter((x) => x.enabled), [settings.sets])
  const names = useMemo(() => new Map(devices.map((d) => [d.slug, d.name])), [devices])
  const deviceName = useCallback((slug: string) => names.get(slug) ?? slug, [names])
  const pickOf = (x: MockupSet) => {
    const p = s.picks[x.device]
    return { on: p?.on ?? false, colour: p && x.colours.includes(p.colour) ? p.colour : x.default_colour }
  }
  const colourOf = (x: MockupSet) => pickOf(x).colour
  const chosen = sets.filter((x) => pickOf(x).on)
  const [metas, retryMetas] = useMetas(sets, colourOf, active)
  const metaOf = (x: MockupSet) => metas[`${x.device}|${colourOf(x)}`]
  const readyMeta = (x: MockupSet) => { const m = metaOf(x); return m?.status === "ready" ? m.meta : null }
  // whether a set colour's 2400 px layers are uploaded (false: ask for 1200 straight away; null: not known yet)
  const fullOf = (device: string, c: string) => { const m = metas[`${device}|${c}`]; return m?.status === "ready" ? m.full : null }

  const focusSet = chosen.find((x) => x.device === s.focus.device) ?? chosen[0] ?? sets.find((x) => x.device === s.focus.device) ?? sets[0] ?? null
  const colour = focusSet ? colourOf(focusSet) : ""
  const metaState = focusSet ? metaOf(focusSet) : undefined
  const meta = metaState?.status === "ready" ? metaState.meta : null
  const angles = useMemo(() => anglesOf(meta, settings.shots), [meta, settings.shots])
  const shotNow = angles.includes(s.focus.shot) ? s.focus.shot : angles[0] ?? 0
  const version = s.design?.version ?? 0
  const A = meta ? meta.template_mm[1] / meta.template_mm[0] : A_DEFAULT
  const asKey = chosen.map((x) => { const m = readyMeta(x); return m ? m.template_mm[1] / m.template_mm[0] : 0 }).filter(Boolean).join(",")
  const As = useMemo(() => (asKey ? asKey.split(",").map(Number) : [A_DEFAULT]), [asKey])

  const [interacting, setInteracting] = useState(false)
  const [job, setJob] = useState<JobState | null>(null)
  const [publishError, setPublishError] = useState<PublishError | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null)
  const [uploaded, setUploaded] = useState<Set<string>>(() => new Set())
  const [pngBusy, setPngBusy] = useState<Set<string>>(() => new Set())
  const [pngStats, setPngStats] = useState<PngStats>({})
  const [announceText, setAnnounceText] = useState("")
  const [collections, setCollections] = useState<Collections>({ status: "loading", items: [] })
  const [hintSeen, setHintSeen] = useState(false)
  const lock = useRef(false)
  const stop = useRef(false)
  const zipAbort = useRef<AbortController | null>(null)
  const zipEx = useRef<Renderer | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const readSeq = useRef(0)
  const versionSeq = useRef(0)
  // committed: the design s.design holds (null: the placeholder). sent: what the workers were last given (undefined:
  // unknown, a send failed). A pick that does not become the design puts the committed one back on the workers.
  const committed = useRef<Blob | null>(null)
  const sent = useRef<Blob | null | undefined>(null)
  // Remove or Make another is putting the placeholder back: a pick now would be cleared right after
  const clearing = useRef(false)
  // the control that started a ZIP or publish, for focus when it ends
  const jobFrom = useRef<HTMLElement | null>(null)
  const canShare = useMemo(() => { try { return canShareFiles(new File([new Uint8Array(1)], "x.png", { type: "image/png" })) } catch { return false } }, [])

  // leaving the page (after the leave question) counts as Stop and cancels a ZIP: nothing is created after the owner left
  useEffect(() => () => { stop.current = true; zipAbort.current?.abort() }, [])

  const announce = useCallback((text: string) => {
    setAnnounceText("")
    requestAnimationFrame(() => setAnnounceText(text))
  }, [])
  const notePng = useCallback((size: number, bytes: number) => {
    setPngStats((p) => ({ ...p, [size]: { bytes: (p[size]?.bytes ?? 0) + bytes, n: (p[size]?.n ?? 0) + 1 } }))
  }, [])

  const loadCollections = useCallback(() => {
    setCollections((c) => ({ ...c, status: "loading" }))
    api<{ collections?: { id: string; title: string }[] }>("/admin/collections?limit=1000&fields=id,title")
      .then((d) => setCollections({ status: "ready", items: d.collections ?? [] }))
      .catch(() => setCollections((c) => ({ status: "error", items: c.items })))
  }, [])
  useEffect(() => { loadCollections() }, [loadCollections])

  const slugOk = slugValid(s.details.slug)
  const slugState = useSlugCheck(s.details.slug, slugOk, active && !done && (s.step === "details" || s.step === "review"))
  const errors = stepErrors(s, { chosen, metas, colourOf, slugState, deviceName })
  const dirty = Boolean(s.design || s.details.name.trim()) && !done
  useLeaveGuard(job ? JOB_MSG : dirty ? DIRTY_MSG : null)

  // --- pictures -------------------------------------------------------------------------------------
  const stageStep = STAGE_STEPS.includes(s.step)
  const [devicePx, stageRef] = useDevicePx()
  const stage = useStage({
    r: R, ready, set: focusSet, colour, shot: shotNow, meta, full: metaState?.status === "ready" ? metaState.full : null,
    placement: s.placement, version, interacting, devicePx, active: active && !done && stageStep, coarse,
  })

  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const filmOut = Math.min(600, Math.ceil(((phone ? 64 : 76) * dpr) / 64) * 64)
  const hasDesign = Boolean(s.design)
  const filmItems = useMemo<ShotItem[]>(() => {
    if (!focusSet || !meta || !hasDesign || !angles.length) return []
    const i = Math.max(0, angles.indexOf(shotNow))
    const order = [angles[i]]
    for (let d = 1; order.length < angles.length; d++) {
      if (i - d >= 0) order.push(angles[i - d])
      if (i + d < angles.length) order.push(angles[i + d])
    }
    const size = Math.min(...meta.sizes)
    return order.map((n) => ({ slot: String(n), set: focusSet, colour, shot: n, size }))
  }, [focusSet, colour, meta, angles, shotNow, hasDesign])
  const [film, retryFilm] = useShots(R, ready, "film", 1, filmItems, { placement: s.placement, version, out: filmOut, active: active && !done && stageStep && hasDesign })

  const [cardOut, cardRef] = useBoxOut(208)
  const cardItems = useMemo<ShotItem[]>(() => sets.flatMap((x) => {
    const m = readyMeta(x)
    const n = m ? anglesOf(m, settings.shots)[0] : undefined
    return m && n !== undefined ? [{ slot: x.device, set: x, colour: colourOf(x), shot: n, size: Math.min(...m.sizes) }] : []
  }), [sets, metas, s.picks, settings.shots])
  const [cards, retryCard] = useShots(R, ready, "cards", 2, cardItems, { placement: s.placement, version, out: cardOut, active: active && !done && s.step === "models" })

  const uvPick = useUvPick(focusSet, colour, shotNow, active && s.step === "placement" && hasDesign)

  // --- design file --------------------------------------------------------------------------------------
  // the object URL and preview go with the file (a new version of the same design keeps them)
  const designUrl = s.design?.url, designPreview = s.design?.preview
  useEffect(() => () => { if (designUrl) URL.revokeObjectURL(designUrl); designPreview?.close() }, [designUrl, designPreview])

  /** Puts the committed design (or the placeholder) back on the workers when they may hold another image. */
  async function resync(quiet = false) {
    if (!R || sent.current === committed.current) return
    const want = committed.current
    sent.current = want
    try {
      await (want ? R.setImage(want) : R.showPlaceholder())
      // new picture keys: nothing made from the dropped image is shown or reused
      if (want && committed.current === want) dispatch({ type: "design/version", version: ++versionSeq.current })
    } catch {
      if (sent.current === want) sent.current = undefined
      if (!quiet) toast("The design couldn't be reloaded. Choose it again.", "error")
    }
  }

  async function chooseFile(f: File) {
    if (!R || job || clearing.current) return
    const seq = ++readSeq.current
    // only the newest pick reports; it also puts the committed design back (a superseded pick leaves that to the newer one)
    const fail = (message: string) => {
      if (seq !== readSeq.current) return
      dispatch({ type: "design/error", message })
      refocus("ms-choose")
      void resync()
    }
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return fail("Use a PNG, JPG or WebP image.")
    if (f.size > MAX_BYTES) return fail(`This file is ${(f.size / 1e6).toFixed(1)} MB. The limit is 60 MB.`)
    dispatch({ type: "design/reading", name: f.name })
    announce("Opening your design…")
    let bmp: ImageBitmap
    try { bmp = await createImageBitmap(f) } catch { return fail("This browser couldn't open that image. Save it as PNG or JPG and try again.") }
    let preview: ImageBitmap | null = null
    try {
      if (seq !== readSeq.current) return
      const w = bmp.width, h = bmp.height
      if (Math.max(w, h) > MAX_SIDE) return fail(`This image is too large (${w} × ${h} px). Keep the long side at 12,000 px or less.`)
      const k = Math.min(1, 640 / Math.max(w, h))
      const small = downscale(bmp, w * k, h * k, lowMemory ? MAX_CANVAS_PX : Infinity)
      preview = small.transferToImageBitmap()
      small.width = small.height = 0
      sent.current = f
      await R.setImage(f, bmp)
      if (seq !== readSeq.current) return
      const acr = across({ w, h }, A_DEFAULT)
      const scale = designScale(w, h, rendererOptions("detail", lowMemory))
      const firstDevice = chosen.length || !sets[0] ? null : { device: sets[0].device, colour: colourOf(sets[0]) }
      committed.current = f
      dispatch({
        type: "design/ready", firstDevice,
        design: { file: f, url: URL.createObjectURL(f), w, h, across: acr, scale, reduced: scale < 1, version: ++versionSeq.current, preview },
      })
      preview = null // state owns it now; the design cleanup above closes it
      refocus("ms-choose") // the file card's Replace
    } catch (error: any) {
      fail(String(error?.message ?? error))
    } finally { bmp.close(); preview?.close() }
  }
  const chooseRef = useRef(chooseFile)
  chooseRef.current = chooseFile
  const chooseClick = () => fileInput.current?.click()

  /** Sends the placeholder back before the design leaves the state, so no picture is made of a design that is gone. */
  async function clearDesign() {
    readSeq.current++
    committed.current = null
    sent.current = null
    clearing.current = true
    try {
      if (R) await R.showPlaceholder()
    } catch {
      sent.current = undefined
    } finally { clearing.current = false }
  }

  async function removeDesign() {
    if (job || lock.current || clearing.current) return // a running ZIP may be using these workers
    await clearDesign()
    dispatch({ type: "design/remove" })
    refocus("ms-choose") // the dropzone's Choose file
  }

  // --- placement ---------------------------------------------------------------------------------------
  const fixRef = useRef({ design: s.design, As })
  fixRef.current = { design: s.design, As }
  const placer = useMemo<Placer>(() => {
    const fix = (p: Placement) => { const { design, As: as } = fixRef.current; return design ? clampPlacement(p, design, as) : p }
    return {
      set: (p) => { const c = fix(p); dispatch({ type: "place/set", p: c }); return c },
      begin: () => { dispatch({ type: "place/begin" }); setInteracting(true) },
      end: () => { dispatch({ type: "place/end" }); setInteracting(false) },
      apply: (p) => dispatch({ type: "place/apply", p: fix(p) }),
      undo: () => dispatch({ type: "place/undo" }),
      reset: () => dispatch({ type: "place/reset" }),
    }
  }, [])
  // a newly chosen model with another print shape can make the old position show white: pull it back in
  useEffect(() => {
    if (!s.design) return
    const c = clampPlacement(s.placement, s.design, As)
    if (placementKey(c) !== placementKey(s.placement)) dispatch({ type: "place/set", p: c })
  }, [As, s.design])

  const zoomPct = Math.round(s.placement.zoom * 100)
  const zoomSeen = useRef(zoomPct)
  useEffect(() => {
    if (zoomSeen.current === zoomPct || s.step !== "placement") { zoomSeen.current = zoomPct; return }
    const t = setTimeout(() => { zoomSeen.current = zoomPct; if (!rangeFocused()) announce(`Size ${zoomPct} percent`) }, 500)
    return () => clearTimeout(t)
  }, [zoomPct])
  // the stage's arrow keys and drags get spoken feedback too
  const oxPct = Math.round(s.placement.ox * 100), oyPct = Math.round(s.placement.oy * 100)
  const posKey = `${oxPct},${oyPct}`
  const posSeen = useRef(posKey)
  useEffect(() => {
    if (posSeen.current === posKey || s.step !== "placement") { posSeen.current = posKey; return }
    const t = setTimeout(() => {
      posSeen.current = posKey
      if (!rangeFocused()) announce(`Position: ${way(oxPct, "left", "right")}, ${way(oyPct, "up", "down")}`)
    }, 500)
    return () => clearTimeout(t)
  }, [posKey])

  const focusShot = (n: number) => {
    dispatch({ type: "focus", shot: n })
    const i = angles.indexOf(n)
    const name = meta?.shots.find((x) => x.n === n)?.name ?? ""
    if (i >= 0) announce(`Angle ${i + 1} of ${angles.length}: ${shotTitle(name)}`)
  }
  const onFocus = (f: { device?: string; shot?: number }) => {
    if (f.device !== undefined) dispatch({ type: "focus", device: f.device })
    if (f.shot !== undefined) focusShot(f.shot)
  }

  // on entering Placement, an angle that shows little print gives way to the main picture
  const enteredPlacement = useRef(false)
  useEffect(() => { if (s.step === "placement") enteredPlacement.current = true }, [s.step])
  useEffect(() => {
    if (!enteredPlacement.current || s.step !== "placement" || !uvPick) return
    enteredPlacement.current = false
    const first = angles.find((n) => settings.shots.includes(n))
    if (uvPick.print < 400 && first !== undefined && first !== shotNow) dispatch({ type: "focus", shot: first })
  }, [uvPick, s.step])

  // --- steps -------------------------------------------------------------------------------------------
  const go = (step: StepId, fromReview = false) => dispatch({ type: "go", step, fromReview })
  const focusInvalid = (step: StepId) => {
    let id = step === "design" ? "ms-choose" : step === "models" ? "ms-all" : ""
    if (step === "details") {
      const f = fieldErrors(s, slugState)
      id = f.name ? "ms-f-name" : f.slug ? "ms-f-slug" : f.newCollection ? "ms-f-newcol" : f.stock ? "ms-f-stock" : ""
    }
    if (id) requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(id)?.focus()))
  }
  const showStepError = (step: StepId) => {
    if (step !== s.step) go(step)
    dispatch({ type: "errors/show" })
    focusInvalid(step)
    // Design shows its error inline as an alert, which speaks it
    if (step !== "design") announce(errors[step] ?? "")
  }
  function next() {
    if (s.reading || job || lock.current) return
    if (s.step === "review") { void publish(); return }
    if (errors[s.step]) { showStepError(s.step); return }
    const target = s.fromReview ? "review" : STEPS[stepIndex(s.step) + 1].id
    const blocked = blockedBy(errors, stepIndex(target))
    if (blocked) { showStepError(blocked); return }
    go(target)
  }
  const back = () => { if (!job && s.step !== "design") go(STEPS[stepIndex(s.step) - 1].id) }

  const firstStep = useRef(true)
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return }
    if (!active) return
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
    requestAnimationFrame(() => document.getElementById("ms-h")?.focus({ preventScroll: true }))
    const i = stepIndex(s.step)
    announce(`Step ${i + 1} of 5: ${STEPS[i].label}`)
  }, [s.step])

  // the done screen replaces the stepper, frame and footer (and the button that was pressed): its heading takes focus
  useEffect(() => {
    if (!done || !active) return
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
    requestAnimationFrame(() => document.getElementById("ms-h")?.focus({ preventScroll: true }))
  }, [done])

  // a ZIP or publish swaps or disables the control that started it: keep keyboard focus on what can be used
  const jobKind = job?.kind
  const lastKind = useRef<JobState["kind"] | undefined>(undefined)
  useEffect(() => {
    const ended = lastKind.current
    lastKind.current = jobKind
    if (!active) return
    const lost = () => {
      const a = document.activeElement as HTMLButtonElement | null
      return !a || a === document.body || !a.isConnected || a.disabled || a.id === "ms-pub-stop" || a.id === "ms-job-cancel"
    }
    if (jobKind) {
      if (lost()) document.getElementById(jobKind === "publish" ? "ms-pub-stop" : "ms-job-cancel")?.focus()
      return
    }
    const from = jobFrom.current
    jobFrom.current = null
    if (!from || !lost()) return // the user moved on meanwhile: leave focus alone
    if (ended === "publish") {
      // success: the done screen's heading takes focus (above); otherwise Try again, Change URL or Publish again
      if (!done) document.getElementById("ms-pub-retry")?.focus()
      return
    }
    // a ZIP finished or was cancelled: back to the button that started it, else Download all, else the heading
    if (from.isConnected && !(from as HTMLButtonElement).disabled) from.focus()
    else (document.getElementById("ms-zip-all") ?? document.getElementById("ms-h"))?.focus()
  }, [jobKind])

  // --- single pictures ---------------------------------------------------------------------------------
  async function makePng(set: MockupSet, c: string, shot: number) {
    if (sent.current !== committed.current) {
      // the workers may hold a design that never opened: put the committed one back first
      if (s.reading) throw new Error("Wait until your design has opened.")
      await resync(true)
      if (sent.current !== committed.current) throw new Error("The design couldn't be reloaded. Choose it again.")
    }
    const m = await loadMeta(set.base_url, c)
    const shotName = m.shots.find((x) => x.n === shot)?.name ?? String(shot)
    const ep = R!.epoch.current
    const lane = `png-${cellKey(set.device, c, shot, version)}`
    const big = fullOf(set.device, c) !== false
    const r = await R!.detail.png({
      set, colour: c, shot, size: big ? 2400 : 1200, width: big ? R!.hq : Math.min(R!.hq, 3072), placement: s.placement, background: s.background, lane, prio: 1,
    }, R!.detail.bump(lane))
    if (ep !== R!.epoch.current) throw new Error("The design changed while the picture was made. Try again.")
    notePng(r.size, r.blob.size)
    return { ...r, name: pngName(baseName(s.details, s.design?.file.name), set.device, c, shot, shotName, r.size) }
  }
  async function downloadOne(set: MockupSet, c: string, shot: number) {
    if (!R || !s.design) return
    const cell = cellKey(set.device, c, shot, version)
    if (pngBusy.has(cell)) return
    setPngBusy((b) => new Set(b).add(cell))
    try {
      const r = await makePng(set, c, shot)
      saveBlob(r.blob, r.name)
      toast(r.size < 2400 ? `Saved ${r.name}. 2400 px isn't uploaded for ${deviceName(set.device)} ${c} yet, so it is 1200 px.` : `Saved ${r.name}.`, "success")
    } catch (error: any) {
      if (error?.name !== "AbortError") toast(String(error?.message ?? error), "error")
    } finally {
      setPngBusy((b) => { const n = new Set(b); n.delete(cell); return n })
    }
  }

  const openFull = (set: MockupSet, c: string, shots: number[], index: number) => { if (shots.length) setLightbox({ device: set.device, colour: c, shots, index }) }
  const openStageFull = () => { if (focusSet && meta && s.design) openFull(focusSet, colour, angles, Math.max(0, angles.indexOf(shotNow))) }
  const downloadStage = () => { if (focusSet && meta) void downloadOne(focusSet, colour, shotNow) }

  // --- keyboard and paste ------------------------------------------------------------------------------
  const keys = useRef({ s, done, angles, shotNow, focusShot, openStageFull, downloadStage })
  keys.current = { s, done, angles, shotNow, focusShot, openStageFull, downloadStage }
  useEffect(() => {
    if (!active) return
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return
      const t = e.target as HTMLElement | null
      const k = keys.current
      if (k.done) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
        // text fields keep their own undo; a slider, radio or checkbox has none, so the placement is undone
        if (t?.closest?.("input:not([type=range]):not([type=radio]):not([type=checkbox]), select, textarea, [contenteditable='true']")) return
        if (k.s.step === "placement" && k.s.design) { e.preventDefault(); dispatch({ type: "place/undo" }) }
        return
      }
      if (t?.closest?.("input, select, textarea, [contenteditable='true']")) return
      if (e.ctrlKey || e.metaKey || e.altKey || !k.s.design || !STAGE_STEPS.includes(k.s.step) || !k.angles.length) return
      if (e.key === "[" || e.key === "]") {
        e.preventDefault()
        const i = k.angles.indexOf(k.shotNow)
        k.focusShot(k.angles[(i + (e.key === "]" ? 1 : -1) + k.angles.length) % k.angles.length])
      } else if (e.key === "f" || e.key === "F") { e.preventDefault(); k.openStageFull() } else if (e.key === "d" || e.key === "D") { e.preventDefault(); k.downloadStage() }
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [active])
  useEffect(() => {
    if (!active || s.step !== "design" || done) return
    const on = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return
      const f = e.clipboardData?.files?.[0]
      if (f) { e.preventDefault(); void chooseRef.current(f) }
    }
    window.addEventListener("paste", on)
    return () => window.removeEventListener("paste", on)
  }, [active, s.step, done])

  // --- ZIP and publish ---------------------------------------------------------------------------------
  async function runZip(only: MockupSet | null) {
    if (lock.current || job || !R || !s.design) return
    lock.current = true
    jobFrom.current = document.activeElement as HTMLElement | null
    const ctl = new AbortController()
    zipAbort.current = ctl
    const base = baseName(s.details, s.design.file.name)
    try {
      const list = only ? [only] : [...chosen].sort((a, b) => (a === focusSet ? -1 : b === focusSet ? 1 : 0))
      const items: ZipItem[] = []
      for (const set of list) {
        const c = colourOf(set), m = await loadMeta(set.base_url, c), model = deviceName(set.device), full = fullOf(set.device, c)
        for (const n of anglesOf(m, settings.shots)) {
          const shotName = m.shots.find((x) => x.n === n)?.name ?? String(n)
          items.push({ set, colour: c, shot: n, shotName, model, full, entry: (size) => (only ? "" : `${set.device}_${slugify(c)}/`) + entryName(n, shotName, size) })
        }
      }
      setJob({ kind: "zip", phase: "making", done: 0, total: items.length, label: "Starting…", eta: "" })
      // cancelled (or the page left) while the layer info loaded: no export worker for nothing
      if (ctl.signal.aborted) { toast("Download cancelled."); return }
      const ex = await R.exporter(s.design.file)
      zipEx.current = ex
      if (ctl.signal.aborted) { toast("Download cancelled."); return }
      await downloadShots({
        items, zipName: only ? modelZipName(base, only.device, colourOf(only)) : allZipName(base), ex, hq: R.hq,
        placement: s.placement, background: s.background, signal: ctl.signal, onJob: setJob, epoch: R.epoch, onPng: notePng,
      })
    } catch (error: any) {
      toast(String(error?.message ?? error), "error")
    } finally {
      lock.current = false
      zipAbort.current = null
      zipEx.current = null
      R.releaseExporter()
      setJob(null)
    }
  }
  const cancelZip = () => { zipAbort.current?.abort(); zipEx.current?.bump("zip") }

  async function publish() {
    if (lock.current || job || !R) return
    const blocked = blockedBy(errors, stepIndex("review"))
    if (blocked || !s.design) { showStepError(blocked ?? "design"); return }
    lock.current = true
    stop.current = false
    jobFrom.current = document.activeElement as HTMLElement | null
    setPublishError(null)
    setUploaded(new Set())
    const design = s.design, details = s.details
    try {
      const result = await publishProduct({
        settings, models: chosen.map((x) => ({ set: x, colour: colourOf(x), model: deviceName(x.device), full: fullOf(x.device, colourOf(x)) })), details, placement: s.placement, version,
        hq: R.hq, lowMemory, exporter: () => R.exporter(design.file), stopped: () => stop.current,
        onJob: setJob, onUploaded: (cell) => setUploaded((u) => new Set(u).add(cell)),
        onMilestone: (pct) => announce(`${pct} percent of the pictures are made and uploaded.`),
      })
      const message = details.status === "draft" ? "Draft created." : "Product published."
      setDone({ slug: result.slug, status: details.status, models: chosen.length, perModel: result.perModel, title: details.name.trim() })
      toast(message, "success")
      announce(message.slice(0, -1))
      if (details.collection === NEW_COLLECTION) loadCollections()
    } catch (error: any) {
      // Stop, or the owner left the page (then nothing is said): a request that may have created it is still reported
      if (error instanceof Stopped || (stop.current && !error?.maybeCreated)) setPublishError({ message: "", stopped: true })
      else {
        const message = String(error?.message ?? error)
        setPublishError({ message, taken: error instanceof Taken, maybeCreated: Boolean(error?.maybeCreated) })
        toast(message, "error")
      }
    } finally {
      lock.current = false
      R.releaseExporter()
      setJob(null)
    }
  }

  async function again() {
    if (job || lock.current || clearing.current) return
    const title = s.details.collection === NEW_COLLECTION ? s.details.newCollection.trim() : undefined
    await clearDesign()
    setDone(null)
    setUploaded(new Set())
    setPublishError(null)
    dispatch({ type: "again", collectionTitle: title })
  }

  // --- render ------------------------------------------------------------------------------------------
  if (!sets.length) return <div className="ms"><EmptyModels onOpenSets={onOpenSets} /></div>

  const busy = Boolean(job)
  const publishing = job?.kind === "publish"
  const reviewModels: ReviewModel[] = chosen.map((x) => ({ set: x, colour: colourOf(x), model: deviceName(x.device), meta: metaOf(x) }))
  const pictures = chosen.reduce((sum, x) => { const m = readyMeta(x); return sum + (m ? settings.shots.filter((n) => m.shots.some((y) => y.n === n)).length : settings.shots.length) }, 0)
  const previewCommon: Omit<PreviewProps, "mode"> = {
    step: s.step, list: chosen.length ? chosen : sets, focusSet, colour, deviceName, meta, metaState, angles, gallery: settings.shots, shotNow, stage,
    film, onFilmRetry: retryFilm, uvPick, placement: s.placement, placer, hasDesign, coarse, hintSeen, onHintSeen: () => setHintSeen(true),
    onFocus, onColour: (device, c) => dispatch({ type: "pick/colour", device, colour: c }),
    onOpenFull: openStageFull, onDownload: downloadStage,
    downloading: focusSet ? pngBusy.has(cellKey(focusSet.device, colour, shotNow, version)) : false,
    onChooseFile: chooseClick, onDropFile: (f) => { void chooseFile(f) }, onRetryMeta: retryMetas, stageRef,
  }

  let body: ReactNode = null
  if (s.step === "design") {
    // keyed siblings, so React moves them instead of remounting: with no design the dropzone comes first in the
    // DOM, as it does on the phone layout, so the tab order follows what is seen
    const preview = <Preview key="preview" {...previewCommon} mode={s.design ? "static" : "placeholder"} />
    const panel = <DesignPanel key="panel" design={s.design} reading={s.reading} error={s.designError || (s.showErrors && errors.design) || ""} A={A}
      maxAcross={rendererOptions("detail", lowMemory).maxAcross} disabled={busy}
      onChoose={chooseClick} onFile={(f) => { void chooseFile(f) }} onRemove={() => { void removeDesign() }} />
    body = <div className={`ms-split${s.design ? "" : " is-empty"}`} data-step="design">
      <StepHead step="design" title="Upload your design" sub="One flat image. It is printed over the back and sides of the case." />
      {s.design ? [preview, panel] : [panel, preview]}
    </div>
  } else if (s.step === "models") {
    body = <>
      <StepHead step="models" title="Choose the models" sub="Every model you choose gets its own pictures in this one product. The phone colour only changes the pictures, not what is sold." />
      <ModelsStep sets={sets} pickOf={pickOf} metas={metas} cards={cards} cardRef={cardRef} deviceName={deviceName} disabled={busy}
        onToggle={(x) => dispatch({ type: "pick/toggle", device: x.device, colour: colourOf(x) })}
        onAll={(on) => dispatch({ type: "pick/all", on, devices: sets.map((x) => ({ device: x.device, colour: colourOf(x) })) })}
        onColour={(x, c) => dispatch({ type: "pick/colour", device: x.device, colour: c })} onRetryMeta={retryMetas} onCardRetry={retryCard} />
    </>
  } else if (s.step === "placement" && s.design) {
    body = <div className="ms-split" data-step="placement">
      <StepHead step="placement" title="Place your design" sub={coarse
        ? "Drag it on the phone or pinch to zoom. One position is used for every model."
        : "Drag it on the phone, scroll to zoom, or use the controls. One position is used for every model."} />
      <Preview {...previewCommon} mode="editable" />
      <PlacementPanel placement={s.placement} canUndo={s.past.length > 0} design={s.design} As={As} A={A} placer={placer} angles={angles} meta={meta} onFocusShot={focusShot} />
    </div>
  } else if (s.step === "details") {
    const firstShot = angles.find((n) => settings.shots.includes(n))
    const mini = firstShot !== undefined ? film[String(firstShot)] : undefined
    body = <div className="ms-split" data-step="details">
      <StepHead step="details" title="Product details" sub="The title is the design name customers see." />
      <Preview {...previewCommon} mode="static" />
      <MiniSummary bitmap={mini && "bitmap" in mini ? mini.bitmap : null} title={s.details.name.trim() || s.design?.file.name || ""} models={chosen.length} colour={colour} />
      <DetailsForm s={s} slugState={slugState} collections={collections} onRetryCollections={loadCollections} onSubmit={next}
        onPatch={(patch) => dispatch({ type: "details", patch })} />
    </div>
  } else if (s.step === "review") {
    body = <>
      <StepHead step="review" title="Review & publish" sub="Check every picture. Downloads are full quality; shop images are compressed only when they are uploaded." />
      {/* every tile is two tab stops: one stop straight to the footer's primary action */}
      {!busy && <button type="button" className="ms-skip" onClick={() => document.getElementById("ms-primary")?.focus()}>
        {s.details.status === "draft" ? "Skip to Create draft" : "Skip to Publish product"}</button>}
      <div className="ms-review">
        <fieldset className="ms-fs" disabled={publishing}>
          <ReviewSheet r={R} ready={ready} active={active} models={reviewModels} settings={settings} placement={s.placement} version={version} uploaded={uploaded} pngBusy={pngBusy} disabled={busy}
            onOpen={(m, shots, i) => openFull(m.set, m.colour, shots, i)} onDownloadOne={(m, n) => { void downloadOne(m.set, m.colour, n) }} onZip={(m) => { void runZip(m.set) }} />
        </fieldset>
        <aside className="ms-aside">
          {/* no Edit while any job runs (Remove on low-memory devices would change the design mid-ZIP) */}
          <fieldset className="ms-fs" disabled={busy}>
            <SummaryCard design={s.design} models={reviewModels} details={s.details} placement={s.placement} slugState={slugState} onEdit={(step) => go(step, true)} />
          </fieldset>
          <fieldset className="ms-fs" disabled={publishing}>
            <DownloadCard models={reviewModels} background={s.background} onBackground={(value) => dispatch({ type: "background", value })} job={job} publishing={publishing} phone={phone}
              stats={pngStats} onZip={() => { void runZip(null) }} onCancel={cancelZip} />
          </fieldset>
          <PublishCard status={s.details.status} onStatus={(status) => dispatch({ type: "details", patch: { status } })} settings={settings} pictures={pictures}
            job={job} error={publishError} slug={s.details.slug} onStop={() => { if (job?.phase !== "creating") stop.current = true }}
            onRetry={() => { void publish() }} onOpenSettings={onOpenSettings}
            onChangeUrl={() => {
              dispatch({ type: "details", patch: { slugOpen: true } })
              go("details", true)
              requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("ms-f-slug")?.focus()))
            }} />
        </aside>
      </div>
    </>
  }

  const hint = s.step === "design"
    ? (s.showErrors && errors.design) || (s.design ? `${s.design.w} × ${s.design.h} px` : "PNG, JPG or WebP")
    : s.step === "models" ? (s.showErrors && errors.models) || `${chosen.length} of ${sets.length} models chosen`
      : s.step === "placement" ? "One position is used for every model."
        : s.step === "details" ? (s.showErrors && errors.details ? "Fill in the highlighted fields." : slugState === "checking" ? "Checking the URL…" : "")
          : `${plural(chosen.length, "model")} × ${settings.shots.length} pictures`
  const hintError = s.showErrors && Boolean(errors[s.step])

  let primary: ReactNode
  if (publishing) primary = <Button variant="primary" loading>{s.details.status === "draft" ? "Creating draft…" : "Publishing…"}</Button>
  else if (s.step === "review") primary = <Button id="ms-primary" variant="primary" disabled={busy} onClick={next}>{s.details.status === "draft" ? "Create draft" : "Publish product"}</Button>
  else primary = <Button variant="primary" disabled={Boolean(s.reading) || busy} onClick={next}>{s.fromReview ? "Back to review" : <>Continue{Icon.arrowRight}</>}</Button>

  const lbSet = lightbox ? sets.find((x) => x.device === lightbox.device) ?? null : null
  const lbMeta = lightbox ? metas[`${lightbox.device}|${lightbox.colour}`] : undefined
  const lbReady = lbMeta?.status === "ready" ? lbMeta : null
  const firstModel = chosen[0]
  const firstMeta = firstModel ? readyMeta(firstModel) : null

  return <div className="ms" data-step={s.step}>
    {!done && <Stepper step={s.step} reached={s.reached} errors={errors} busy={busy} onGo={(step) => go(step)} />}
    {done
      ? <DoneScreen done={done} version={version} placement={s.placement} job={job} onZip={() => { void runZip(null) }} onCancel={cancelZip} onAgain={() => { void again() }}
        first={firstModel && firstMeta ? { set: firstModel, colour: colourOf(firstModel), shots: anglesOf(firstMeta, settings.shots).slice(0, 4) } : null} />
      : <section className="ms-frame" key={s.step} data-dir={s.dir}>{body}</section>}
    {!done && <footer className="ms-foot">
      <Button variant="ghost" className={`back${s.step === "design" ? " is-hidden" : ""}`} icon={Icon.arrowLeft} disabled={busy} aria-hidden={s.step === "design" || undefined} tabIndex={s.step === "design" ? -1 : undefined} onClick={back}>Back</Button>
      <p className={`ms-hint${hintError ? " is-error" : ""}`} aria-live="polite">{hint}</p>
      {primary}
    </footer>}
    {lightbox && lbSet && R && <Lightbox target={lightbox} set={lbSet} meta={lbReady?.meta ?? null} full={lbReady?.full ?? null} model={deviceName(lbSet.device)} r={R}
      placement={s.placement} version={version} background={s.background} standIn={(key) => (stage.key === key ? stage.bitmap : null)} canShare={canShare}
      fileName={(shot, size) => pngName(baseName(s.details, s.design?.file.name), lbSet.device, lightbox.colour, shot, lbReady?.meta.shots.find((x) => x.n === shot)?.name ?? String(shot), size)}
      downloading={pngBusy.has(cellKey(lightbox.device, lightbox.colour, lightbox.shots[lightbox.index], version))}
      onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))} onClose={() => setLightbox(null)}
      onDownload={(n) => { void downloadOne(lbSet, lightbox.colour, n) }} />}
    <p className="sr-only" aria-live="polite">{announceText}</p>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void chooseFile(f) }} />
  </div>
}
