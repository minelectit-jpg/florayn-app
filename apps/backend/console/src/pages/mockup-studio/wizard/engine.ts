// Mockup Studio > New product: render scheduling (MOCKUP_STUDIO.md). Three workers:
// quick (Live drags, filmstrip, cards, review tiles), detail (the sharp stage, the
// lightbox, single PNGs) and export (ZIPs and publishing, made when needed).
import { useCallback, useEffect, useRef, useState } from "react"

import { Renderer, rendererOptions, type JobInput } from "../../../mockup/client"
import { loadMeta, loadUvPick, pickSize, probe2400, type MockupSet, type Placement, type SetMeta, type UvPick } from "../../../mockup/layers"
import { placementKey, type MetaState, type SlugState } from "./state"

// --- renderers ---------------------------------------------------------------------------------------
export type Renderers = {
  quick: Renderer
  detail: Renderer
  lowMemory: boolean
  /** design width for 2400 px pictures: 4096, or 3072 where a canvas is capped at 16.7 MP (iOS) */
  hq: number
  /** bumped whenever the workers get another image; results of jobs posted before that are thrown away */
  epoch: { current: number }
  /** Sends the design to the quick and detail workers. */
  setImage(file: Blob, decoded?: ImageBitmap): Promise<void>
  /** Sends the placeholder design back (after Remove or Make another). */
  showPlaceholder(): Promise<void>
  /**
   * The export worker with the design, made on first use. Low-memory devices reuse detail, sending it this design
   * again first if it may hold another one. Refuses ("Closed.") once the page has gone.
   */
  exporter(file: Blob): Promise<Renderer>
  releaseExporter(): void
}

/** The "Your design" picture the stage shows before an upload, so the real case is visible at once. */
async function drawPlaceholder(): Promise<Blob> {
  await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 1500))])
  const c = document.createElement("canvas")
  c.width = 1050; c.height = 1680
  const g = c.getContext("2d")!
  g.fillStyle = "#f2ecfd"
  g.fillRect(0, 0, c.width, c.height)
  g.textAlign = "center"; g.textBaseline = "middle"
  g.save()
  g.translate(c.width / 2, c.height / 2)
  g.rotate(-Math.PI / 6)
  g.fillStyle = "#e4d9fb"
  g.font = "600 64px \"Instrument Sans\", system-ui, sans-serif"
  for (let row = -9; row <= 9; row++) for (let x = -1400 + (row % 2 ? 200 : 0); x <= 1400; x += 400) g.fillText("FLORAYN", x, row * 140)
  g.restore()
  g.fillStyle = "#b9a3ef"
  g.font = "600 120px \"Instrument Sans\", system-ui, sans-serif"
  g.fillText("Your design", c.width / 2, c.height / 2)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("The placeholder could not be drawn."))), "image/png"))
}

/** [renderers, whether the workers hold an image yet]. Created on mount, disposed on unmount. */
export function useRenderers(lowMemory: boolean): [Renderers | null, boolean] {
  const [r, setR] = useState<Renderers | null>(null)
  const [hasImage, setHasImage] = useState(false)
  useEffect(() => {
    let alive = true, designSet = false
    let placeholder: Promise<Blob> | null = null
    let ex: Renderer | null = null
    const quick = new Renderer(rendererOptions("quick", lowMemory))
    const detail = new Renderer(rendererOptions("detail", lowMemory))
    const epoch = { current: 0 }
    // calls: only the newest both() moves the epoch (an older one that finishes late would throw the newer pictures
    // away). held: the image both workers surely hold, null when unsure (a send failed part-way).
    let calls = 0
    let held: Blob | null = null
    const both = async (file: Blob, decoded?: ImageBitmap) => {
      const mine = ++calls
      try {
        await Promise.all([quick.setImage(file, decoded), detail.setImage(file, decoded)])
      } catch (error) {
        if (mine === calls) held = null
        throw error
      }
      if (mine !== calls) return
      held = file
      epoch.current++
      if (alive) setHasImage(true)
    }
    const value: Renderers = {
      quick, detail, lowMemory, hq: lowMemory ? 3072 : 4096, epoch,
      setImage(file, decoded) { designSet = true; return both(file, decoded) },
      async showPlaceholder() {
        designSet = false
        placeholder ??= drawPlaceholder()
        await both(await placeholder)
      },
      async exporter(file) {
        if (!alive) throw new Error("Closed.")
        if (lowMemory) {
          // ZIPs and publishing render on detail here: never with a design the page did not commit
          if (held !== file) { designSet = true; await both(file) }
          return detail
        }
        if (!ex) {
          const made = new Renderer(rendererOptions("export", false))
          ex = made
          await made.setImage(file)
          if (!alive || ex !== made) { made.dispose(); throw new Error("Closed.") }
        }
        return ex
      },
      releaseExporter() { ex?.dispose(); ex = null },
    }
    setR(value)
    placeholder = drawPlaceholder()
    placeholder.then((blob) => (alive && !designSet ? both(blob) : undefined)).catch(() => undefined)
    return () => { alive = false; quick.dispose(); detail.dispose(); ex?.dispose(); ex = null }
  }, [lowMemory])
  return [r, hasImage]
}

// --- small thumbnails, shared by the filmstrip, the model cards, the review and the done screen -----
const THUMBS = 240
const thumbs = new Map<string, ImageBitmap>()
export const cellKey = (device: string, colour: string, shot: number, version: number) => `${device}|${colour}|${shot}|${version}`
const thumbKey = (cell: string, pk: string, out: number) => `${cell}|${pk}|${out}`
function thumbGet(key: string) {
  const b = thumbs.get(key)
  if (b) { thumbs.delete(key); thumbs.set(key, b) }
  return b && b.width ? b : undefined
}
function thumbSet(key: string, b: ImageBitmap) {
  thumbs.delete(key)
  thumbs.set(key, b)
  while (thumbs.size > THUMBS) thumbs.delete(thumbs.keys().next().value!)
}
/** The largest cached picture of a cell at a placement, any size (an instant, stretched stand-in). */
export function thumbBest(cell: string, pk: string): ImageBitmap | null {
  const prefix = `${cell}|${pk}|`
  let best: ImageBitmap | null = null
  for (const [k, b] of thumbs) if (k.startsWith(prefix) && b.width && (!best || b.width > best.width)) best = b
  return best
}

// --- the stage ---------------------------------------------------------------------------------------
export type StageQuality = "none" | "preview" | "sharpening" | "full"
export type StageView = { bitmap: ImageBitmap | null; size: number; quality: StageQuality; error: string; key: string }
export type StageState = StageView & { retry: () => void }

type StageInput = {
  r: Renderers | null; ready: boolean; set: MockupSet | null; colour: string; shot: number; meta: SetMeta | null
  /** whether this colour's 2400 px layers are uploaded (false: no Full pass) */
  full: boolean | null
  placement: Placement; version: number; interacting: boolean; devicePx: number; active: boolean; coarse: boolean
}

/**
 * The big picture: Live (quick worker, 600 px layers) while the placement moves, Sharp (detail, 1200) when it rests,
 * Full (2400) on big fine-pointer screens. Pictures are replaced, never blanked.
 */
export function useStage(o: StageInput): StageState {
  const pk = placementKey(o.placement)
  const cell = cellKey(o.set?.device ?? "", o.colour, o.shot, o.version)
  const key = `${cell}|${pk}`
  const [view, setView] = useState<StageView>({ bitmap: null, size: 0, quality: "none", error: "", key: "" })
  const [nonce, setNonce] = useState(0)
  const cur = useRef({ key, cell })
  cur.current = { key, cell }
  const latest = useRef(o)
  latest.current = o
  // what is showing: rank 0 stand-in, 1 Live, 2 Sharp, 3 Full; seq orders Live results
  const shown = useRef({ key: "", cell: "", rank: -1, px: 0, seq: 0, owned: null as ImageBitmap | null })
  const prev = useRef({ cell: "", pk: "" })
  const live = useRef<{ busy: boolean; next: (() => void) | null; seq: number }>({ busy: false, next: null, seq: 0 })
  const fullTimer = useRef(0)

  const show = (bitmap: ImageBitmap, owned: boolean, size: number, quality: StageQuality, rank: number, k: string, c: string, px: number, seq = 0) => {
    const old = shown.current.owned
    shown.current = { key: k, cell: c, rank, px, seq, owned: owned ? bitmap : null }
    if (old && old !== bitmap) requestAnimationFrame(() => old.close())
    setView({ bitmap, size, quality, error: "", key: k })
  }
  const fail = (error: any, k: string) => {
    if (error?.name === "AbortError" || k !== cur.current.key) return
    setView((v) => ({ ...v, error: String(error?.message ?? error) }))
  }

  useEffect(() => {
    const { r, ready, set, meta, active, interacting, devicePx: px, coarse, colour, shot, placement, full: has2400 } = latest.current
    if (!active || !ready || !r || !set || !meta || !shot) return
    const k = key, c = cell
    const placementOnly = prev.current.cell === c && prev.current.pk !== pk
    prev.current = { cell: c, pk }
    if (!placementOnly && shown.current.key !== k) {
      const hit = thumbBest(c, pk)
      if (hit) show(hit, false, 0, "sharpening", 0, k, c, px)
    }
    const job = (size: number, width: number, out: number | undefined, lane: string): JobInput => ({ set, colour, shot, size, width, placement, out, lane, prio: 0 })

    if (placementOnly || shown.current.cell !== c) {
      const input = job(Math.min(...meta.sizes), 1024, Math.min(600, px || 600), "live")
      const seq = ++live.current.seq
      const run = () => {
        live.current.busy = true
        const ep = r.epoch.current
        r.quick.bitmap(input, r.quick.bump("live")).then((res) => {
          if (!res) return
          const s = shown.current, now = cur.current
          // a newer picture of this angle while dragging; never over a sharp one of the same or the current placement
          const sharpShowing = s.rank >= 2 && (s.key === k || s.key === now.key)
          if (ep !== r.epoch.current || c !== now.cell || sharpShowing || (s.rank === 1 && s.seq > seq)) { res.bitmap.close(); return }
          show(res.bitmap, true, res.size, k === now.key && !latest.current.interacting ? "sharpening" : "preview", 1, k, c, px, seq)
        }).catch((e) => fail(e, k)).finally(() => {
          live.current.busy = false
          const next = live.current.next
          live.current.next = null
          next?.()
        })
      }
      if (live.current.busy) live.current.next = run
      else run()
    }
    if (interacting) return

    let alive = true
    const needFull = !r.lowMemory && !coarse && px > 1300 && meta.sizes.includes(2400) && has2400 !== false
    // back on a step with the same picture already sharp: nothing to do
    if (shown.current.key === k && shown.current.px === px && shown.current.rank >= (needFull ? 3 : 2)) return
    const accept = (res: { bitmap: ImageBitmap; size: number } | null, ep: number, quality: StageQuality, rank: number) => {
      if (!res) return false
      const s = shown.current
      if (ep !== r.epoch.current || k !== cur.current.key || (s.key === k && s.px === px && s.rank > rank)) { res.bitmap.close(); return false }
      show(res.bitmap, true, res.size, quality, rank, k, c, px)
      return true
    }
    const full = () => {
      const ep = r.epoch.current
      r.detail.bitmap(job(2400, r.hq, px, "stage"), r.detail.bump("stage"))
        .then((res) => { accept(res, ep, "full", 3) }).catch((e) => fail(e, k))
    }
    const sharp = () => {
      const ep = r.epoch.current
      const size = pickSize(meta.sizes, 1200)
      setView((v) => (v.bitmap && v.quality !== "sharpening" ? { ...v, quality: "sharpening" } : v))
      r.detail.bitmap(job(size, 2048, px && px < size ? px : undefined, "stage"), r.detail.bump("stage")).then((res) => {
        if (accept(res, ep, needFull ? "sharpening" : "full", 2) && needFull && alive) fullTimer.current = window.setTimeout(full, 1200)
      }).catch((e) => fail(e, k))
    }
    const t1 = window.setTimeout(sharp, placementOnly ? 150 : 0)
    return () => { alive = false; clearTimeout(t1); clearTimeout(fullTimer.current) }
  }, [key, o.interacting, o.devicePx, o.active, o.meta, o.ready, o.r, nonce])

  // a stage that goes away takes its own picture with it
  useEffect(() => () => { shown.current.owned?.close() }, [])

  const retry = useCallback(() => {
    shown.current = { ...shown.current, key: "", cell: "", rank: -1 }
    setView((v) => ({ ...v, error: "" }))
    setNonce((n) => n + 1)
  }, [])
  return { ...view, retry }
}

// --- many small pictures -----------------------------------------------------------------------------
export type ShotItem = { slot: string; set: MockupSet; colour: string; shot: number; size: number }
export type ShotResult = { bitmap: ImageBitmap; stale: boolean } | { error: string }

/**
 * Small pictures on the quick worker, keyed by slot. After a change the old picture stays (stale) until the new
 * one replaces it, so nothing goes back to a skeleton. A new placement, design or size drops the queued jobs.
 */
export function useShots(r: Renderers | null, ready: boolean, lane: string, prio: number, items: ShotItem[], o: { placement: Placement; version: number; out: number; active: boolean }) {
  const settled = useSettled(o.placement, 300)
  const pk = placementKey(settled)
  const [map, setMap] = useState<Record<string, ShotResult & { k?: string }>>({})
  const [nonce, setNonce] = useState(0)
  const want = useRef<Record<string, string>>({})
  const posted = useRef(new Set<string>())
  const gen = useRef({ g: 0, sig: "", r: null as Renderers | null })
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const itemsKey = items.map((i) => `${i.slot}=${i.set.base_url}|${i.colour}|${i.shot}|${i.size}`).join(",")
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (!o.active || !r || !ready || !o.out) return
    const out = o.out, ep = r.epoch.current
    const sig = `${pk}|${o.version}|${out}|${ep}`
    if (gen.current.sig !== sig || gen.current.r !== r) {
      gen.current = { g: r.quick.bump(lane), sig, r }
      posted.current.clear()
    }
    const g = gen.current.g
    const nextWant: Record<string, string> = {}
    const hits: Record<string, ImageBitmap> = {}
    for (const it of itemsRef.current) {
      const k = thumbKey(cellKey(it.set.device, it.colour, it.shot, o.version), pk, out)
      nextWant[it.slot] = k
      const hit = thumbGet(k)
      if (hit) { hits[it.slot] = hit; continue }
      if (posted.current.has(k)) continue
      posted.current.add(k)
      r.quick.bitmap({ set: it.set, colour: it.colour, shot: it.shot, size: it.size, width: 1024, placement: settled, out, lane, prio }, g).then((res) => {
        posted.current.delete(k)
        if (!res) return
        if (ep !== r.epoch.current) { res.bitmap.close(); return }
        thumbSet(k, res.bitmap)
        if (mounted.current && want.current[it.slot] === k) setMap((m) => ({ ...m, [it.slot]: { bitmap: res.bitmap, stale: false, k } }))
      }, (e) => {
        posted.current.delete(k)
        if (e?.name === "AbortError" || !mounted.current || want.current[it.slot] !== k) return
        setMap((m) => ({ ...m, [it.slot]: { error: String(e?.message ?? e), k } }))
      })
    }
    want.current = nextWant
    setMap((m) => {
      const next: Record<string, ShotResult & { k?: string }> = {}
      for (const slot of Object.keys(nextWant)) {
        const old = m[slot]
        if (hits[slot]) next[slot] = { bitmap: hits[slot], stale: false, k: nextWant[slot] }
        else if (old && "bitmap" in old) next[slot] = { ...old, stale: old.k !== nextWant[slot] }
        else if (old && "error" in old && old.k === nextWant[slot]) next[slot] = old
      }
      return next
    })
  }, [itemsKey, pk, o.version, o.out, o.active, ready, r, nonce])

  const retry = useCallback((slot: string) => {
    setMap((m) => { const next = { ...m }; delete next[slot]; return next })
    setNonce((n) => n + 1)
  }, [])
  return [map as Record<string, ShotResult>, retry] as const
}

/** The cached thumbnail of a cell at a placement, if any (done screen). */
export function cachedThumb(cell: string, placement: Placement) {
  return thumbBest(cell, placementKey(placement))
}

// --- other hooks -------------------------------------------------------------------------------------
/** The value once it has stopped changing for ms. */
export function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value)
  const json = JSON.stringify(value)
  useEffect(() => { const t = setTimeout(() => setSettled(value), ms); return () => clearTimeout(t) }, [json])
  return settled
}

/** The artwork coordinates of a shot for dragging on it; null while loading or when it cannot be read. */
export function useUvPick(set: MockupSet | null, colour: string, shot: number, active: boolean): UvPick | null {
  const key = set && shot ? `${set.base_url}|${colour}|${shot}` : ""
  const [pick, setPick] = useState<{ key: string; pick: UvPick } | null>(null)
  useEffect(() => {
    if (!active || !set || !shot) return
    let alive = true
    loadUvPick(set, colour, shot).then((p) => { if (alive) setPick({ key, pick: p }) }, () => { if (alive) setPick(null) })
    return () => { alive = false }
  }, [key, active])
  return pick?.key === key ? pick.pick : null
}

/** [width in device pixels rounded to 32 (dpr capped at 3), callback ref]. 0 widths (hidden) are ignored. */
export function useDevicePx(): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [px, setPx] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      if (w) setPx(Math.round((w * Math.min(window.devicePixelRatio || 1, 3)) / 32) * 32)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [px, setEl]
}

/** [the thumbnail size for a box: css width x dpr rounded up to 64, at most 600; callback ref]. */
export function useBoxOut(fallback: number): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const [out, setOut] = useState(Math.min(600, Math.ceil((fallback * dpr) / 64) * 64))
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      if (w) setOut(Math.min(600, Math.ceil((w * Math.min(window.devicePixelRatio || 1, 3)) / 64) * 64))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [out, setEl]
}

/** Every enabled set's layer info in its picked colour, and whether its 2400 px layers are uploaded. */
export function useMetas(sets: MockupSet[], colourOf: (s: MockupSet) => string, active: boolean) {
  const [metas, setMetas] = useState<Record<string, MetaState>>({})
  const [nonce, setNonce] = useState(0)
  const started = useRef(new Set<string>())
  const wanted = sets.map((s) => `${s.device}|${colourOf(s)}|${s.base_url}`).join(",")
  useEffect(() => {
    if (!active) return
    for (const s of sets) {
      const c = colourOf(s), k = `${s.device}|${c}`, sk = `${k}|${s.base_url}`
      if (started.current.has(sk)) continue
      started.current.add(sk)
      setMetas((m) => (m[k]?.status === "ready" ? m : { ...m, [k]: { status: "loading" } }))
      loadMeta(s.base_url, c).then((meta) => {
        const has2400 = meta.sizes.includes(2400)
        setMetas((m) => ({ ...m, [k]: { status: "ready", meta, full: has2400 ? null : false } }))
        if (!has2400) return
        const last = Math.max(...meta.shots.map((x) => x.n))
        probe2400(s, c, last).then((full) => setMetas((m) => {
          const now = m[k]
          return now?.status === "ready" && now.meta === meta ? { ...m, [k]: { ...now, full } } : m
        }))
      }, (e) => {
        started.current.delete(sk)
        setMetas((m) => ({ ...m, [k]: { status: "error", message: String(e?.message ?? e) } }))
      })
    }
  }, [wanted, active, nonce])
  const retry = useCallback(() => setNonce((n) => n + 1), [])
  return [metas, retry] as const
}

/** Whether a product URL is free: debounced 500 ms, one request at a time, answers for an old slug ignored. */
export function useSlugCheck(slug: string, valid: boolean, active: boolean): SlugState {
  const [st, setSt] = useState<{ slug: string; state: SlugState }>({ slug: "", state: "idle" })
  useEffect(() => {
    if (!slug || !valid || !active) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/admin/designs/${encodeURIComponent(slug)}`, { credentials: "include", signal: ctl.signal })
        .then((r) => setSt({ slug, state: r.ok ? "taken" : r.status === 404 ? "free" : "unknown" }), (e) => {
          if (e?.name !== "AbortError") setSt({ slug, state: "unknown" })
        })
    }, 500)
    return () => { clearTimeout(t); ctl.abort(); setSt((s) => (s.slug === slug ? s : { slug: "", state: "idle" })) }
  }, [slug, valid, active])
  if (!slug) return "idle"
  if (!valid) return "invalid"
  return st.slug === slug ? st.state : "checking"
}
