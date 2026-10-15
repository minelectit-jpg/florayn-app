// Mockup Studio > New product: one flat design -> mockups for the chosen models
// -> a Product Manager design product, draft or published (MOCKUP_STUDIO.md).
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"

import { api, post } from "../../api"
import { Renderer } from "../../mockup/client"
import { blobToBase64, CENTERED, loadMeta, type MockupSet, type Placement, type SetMeta, type Settings } from "../../mockup/layers"
import { Button, Chip, Field, Progress, slugify, toast, useUnsaved } from "../../ui"

export type Device = { slug: string; name: string; family: string; is_active: boolean }
type Collection = { id: string; title: string }
type Pick = { on: boolean; colour: string }
const NEW_COLLECTION = "__new__"
const PREVIEW_W = 1024
const DETAIL_W = 2048

/** The packed size closest to the wanted one without going over, when possible. */
const pickSize = (sizes: number[], want: number) => [...sizes].sort((a, b) => a - b).filter((s) => s <= want).pop() ?? Math.min(...sizes)

function Canvas({ image, className }: { image: ImageData | null | undefined; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !image) return
    c.width = image.width; c.height = image.height
    c.getContext("2d")!.putImageData(image, 0, 0)
  }, [image])
  return <canvas ref={ref} className={className} />
}

function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => { const t = setTimeout(() => setSettled(value), ms); return () => clearTimeout(t) }, [JSON.stringify(value)])
  return settled
}

export default function NewProduct({ settings, devices }: { settings: Settings; devices: Device[] }) {
  const sets = useMemo(() => settings.sets.filter((s) => s.enabled), [settings.sets])
  const deviceName = (slug: string) => devices.find((d) => d.slug === slug)?.name ?? slug
  const stage = useRef<Renderer | null>(null)
  const bg = useRef<Renderer | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState("")
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [version, setVersion] = useState(0)
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [current, setCurrent] = useState<string | null>(null)
  const [shot, setShot] = useState(settings.shots[0] ?? 1)
  const [placement, setPlacement] = useState<Placement>(CENTERED)
  const settledPlacement = useSettled(placement, 400)
  const [meta, setMeta] = useState<SetMeta | null>(null)
  const [stageImage, setStageImage] = useState<ImageData | null>(null)
  const [thumbs, setThumbs] = useState<Record<number, ImageData | null>>({})
  const [tiles, setTiles] = useState<Record<string, ImageData | null>>({})
  const [renderError, setRenderError] = useState("")
  const [over, setOver] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [manualSlug, setManualSlug] = useState(false)
  const [description, setDescription] = useState("")
  const [collections, setCollections] = useState<Collection[]>([])
  const [collection, setCollection] = useState("")
  const [newCollection, setNewCollection] = useState("")
  const [stock, setStock] = useState("0")
  const [status, setStatus] = useState("draft")
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const lock = useRef(false)

  useEffect(() => {
    stage.current = new Renderer(); bg.current = new Renderer()
    api("/admin/collections?limit=1000&fields=id,title").then((d) => setCollections(d.collections ?? [])).catch(() => setCollections([]))
    return () => { stage.current?.dispose(); bg.current?.dispose() }
  }, [])
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }, [fileUrl])

  const pick = (s: MockupSet): Pick => picks[s.device] ?? { on: false, colour: s.default_colour }
  const chosen = sets.filter((s) => pick(s).on)
  const currentSet = sets.find((s) => s.device === current && pick(s).on) ?? chosen[0] ?? sets[0]
  const colour = currentSet ? pick(currentSet).colour : ""
  const gallery = settings.shots.filter((n) => meta?.shots.some((s) => s.n === n))
  const shotNow = gallery.includes(shot) ? shot : gallery[0]
  const shotName = meta?.shots.find((s) => s.n === shotNow)?.name.replace(/^\d+\s*/, "") ?? ""
  useUnsaved(Boolean(file || name) && !created)

  useEffect(() => {
    if (!currentSet) return
    setMeta(null)
    loadMeta(currentSet.base_url, colour).then(setMeta).catch((e) => setRenderError(e.message))
  }, [currentSet?.device, currentSet?.base_url, colour])

  async function chooseFile(next: File | null | undefined) {
    if (!next) return
    if (!/^image\/(png|jpeg|webp)$/.test(next.type)) return toast("Use a PNG, JPG or WebP image.", "error")
    try {
      const bitmap = await createImageBitmap(next)
      setDims({ w: bitmap.width, h: bitmap.height }); bitmap.close()
      await Promise.all([stage.current!.setImage(next), bg.current!.setImage(next)])
      setFile(next); setFileUrl(URL.createObjectURL(next)); setVersion((v) => v + 1)
      setPlacement(CENTERED); setTiles({}); setThumbs({}); setStageImage(null); setRenderError(""); setCreated(null)
      if (!name) {
        const base = next.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim()
        setName(base); if (!manualSlug) setSlug(slugify(base))
      }
      if (!chosen.length && sets[0]) setPicks((all) => ({ ...all, [sets[0].device]: { ...pick(sets[0]), on: true } }))
    } catch { toast("This browser cannot open that image.", "error") }
  }

  const job = (set: MockupSet, c: string, size: number, n: number, width: number, p: Placement, lane: string) => ({ set, colour: c, size, shot: n, width, placement: p, lane })

  // the big picture: fast at the small size, then sharp once the sliders rest
  useEffect(() => {
    if (!file || !currentSet || !meta || !shotNow) return
    const r = stage.current!
    const small = Math.min(...meta.sizes)
    const gen = r.bump("stage")
    r.render(job(currentSet, colour, small, shotNow, PREVIEW_W, placement, "stage"), gen)
      .then((img) => { if (img) { setStageImage(img); setRenderError("") } }).catch((e) => setRenderError(e.message))
    const detail = pickSize(meta.sizes, 1200)
    if (detail === small) return
    const timer = setTimeout(() => {
      const g2 = r.bump("stage")
      r.render(job(currentSet, colour, detail, shotNow, DETAIL_W, placement, "stage"), g2).then((img) => img && setStageImage(img)).catch(() => undefined)
    }, 450)
    return () => clearTimeout(timer)
  }, [version, currentSet?.device, colour, shotNow, meta, placement.zoom, placement.ox, placement.oy])

  // every gallery image of the current model, small
  useEffect(() => {
    if (!file || !currentSet || !meta) return
    const r = bg.current!
    const gen = r.bump("thumbs")
    let stop = false
    ;(async () => {
      for (const n of gallery) {
        const img = await r.render(job(currentSet, colour, Math.min(...meta.sizes), n, PREVIEW_W, settledPlacement, "thumbs"), gen).catch(() => null)
        if (stop || !img) return
        setThumbs((all) => ({ ...all, [n]: img }))
      }
    })()
    return () => { stop = true }
  }, [version, currentSet?.device, colour, meta, settledPlacement.zoom, settledPlacement.ox, settledPlacement.oy])

  async function previewAll() {
    if (!file || !chosen.length) return toast("Choose a design and at least one model.", "error")
    const r = bg.current!
    const gen = r.bump("tiles")
    setTiles(Object.fromEntries(chosen.map((s) => [s.device, null])))
    for (const s of chosen) {
      try {
        const m = await loadMeta(s.base_url, pick(s).colour)
        const first = settings.shots.find((n) => m.shots.some((x) => x.n === n)) ?? m.shots[0].n
        const img = await r.render(job(s, pick(s).colour, Math.min(...m.sizes), first, PREVIEW_W, placement, "tiles"), gen)
        if (!img) return
        setTiles((all) => ({ ...all, [s.device]: img }))
      } catch (error: any) { toast(`${deviceName(s.device)}: ${error.message}`, "error") }
    }
  }

  const theme = collection === NEW_COLLECTION ? newCollection.trim() : collection
  function check() {
    if (!file) throw new Error("Choose the design image first.")
    if (!chosen.length) throw new Error("Choose at least one model.")
    if (!name.trim()) throw new Error("Enter the design name.")
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Enter a valid product URL (letters, numbers and dashes).")
    if (collection === NEW_COLLECTION && !theme) throw new Error("Enter the new collection's name.")
    const qty = Number(stock)
    if (!stock.trim() || !Number.isSafeInteger(qty) || qty < 0) throw new Error("Enter a whole starting stock, zero or more.")
  }

  async function publish() {
    if (lock.current) return
    try { check() } catch (error: any) { return toast(error.message, "error") }
    lock.current = true
    const r = bg.current!
    try {
      const taken = await fetch(`/admin/designs/${slug}`, { credentials: "include" })
      if (taken.ok) throw new Error(`The URL "${slug}" is already used by another design. Change the product URL.`)
      const total = chosen.length * settings.shots.length
      let done = 0
      const pairs: Record<string, string[]> = {}
      const gen = r.bump("publish")
      for (const s of chosen) {
        const c = pick(s).colour
        const m = await loadMeta(s.base_url, c)
        const size = pickSize(m.sizes, settings.image_size)
        const urls: string[] = []
        for (const n of settings.shots) {
          if (!m.shots.some((x) => x.n === n)) { done++; continue }
          setProgress({ done, total, label: `${deviceName(s.device)}: image ${urls.length + 1}` })
          const blob = await r.webp({ ...job(s, c, size, n, size >= 2400 ? 4096 : 3072, placement, "publish"), quality: settings.quality }, gen)
          const body = { designSlug: slug, caseTypeSlug: settings.case_type, deviceSlug: s.device, index: urls.length + 1, filename: `${urls.length + 1}.webp`, mimeType: "image/webp", contentBase64: await blobToBase64(blob) }
          const uploaded = await post<{ url: string }>("/admin/designs/upload", body).catch(() => post<{ url: string }>("/admin/designs/upload", body))
          urls.push(uploaded.url)
          done++
        }
        if (!urls.length) throw new Error(`${deviceName(s.device)} has none of the gallery shots.`)
        pairs[s.device] = urls
      }
      setProgress({ done, total, label: status === "draft" ? "Creating the draft" : "Publishing" })
      const result = await post("/admin/designs/custom", {
        name: name.trim(), slug, description, theme: theme || null, status, blankStock: Number(stock),
        pairs: { [settings.case_type]: pairs },
      })
      setCreated(result.result?.design ?? slug)
      toast(status === "draft" ? "Draft created." : "Product published.", "success")
    } catch (error: any) {
      toast(error.message, "error")
    } finally { lock.current = false; setProgress(null) }
  }

  function reset() {
    setCreated(null); setName(""); setSlug(""); setManualSlug(false); setDescription("")
    setFile(null); setFileUrl(""); setDims(null); setStageImage(null); setThumbs({}); setTiles({}); setPlacement(CENTERED)
  }

  if (!sets.length) return <div className="card stack"><h2>No mockup sets yet</h2><p className="muted">Upload a model's Blender layers on the Mockup sets tab first.</p></div>
  if (created) return <div className="card stack">
    <h2>{status === "draft" ? "Draft created" : "Product published"}</h2>
    <p>"{name}": {chosen.length} model{chosen.length === 1 ? "" : "s"}, {settings.shots.length} images each.</p>
    <div className="row"><a className="btn primary" href={`/app/product-manager?slug=${encodeURIComponent(created)}`} target="_blank" rel="noreferrer">Open in Product Manager</a><Button onClick={reset}>Make another</Button></div>
  </div>

  const busy = Boolean(progress)
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void chooseFile(e.dataTransfer.files?.[0]) }
  return <div className="studio">
    <section className="stage">
      {stageImage ? <Canvas image={stageImage} className="shot-big" /> : <div className="empty">{file ? "Putting the design on the case..." : "Choose a design to see it on the case."}</div>}
      {renderError && <p className="note error" style={{ marginTop: 10 }}>{renderError}</p>}
      {file && currentSet && <p className="faint" style={{ marginTop: 10 }}>{deviceName(currentSet.device)} · {colour} · {shotName}</p>}
      {file && gallery.length > 0 && <div className="thumbs">{gallery.map((n) => <button key={n} type="button" aria-pressed={n === shotNow} aria-label={`Show image ${n}`} onClick={() => setShot(n)}><Canvas image={thumbs[n]} /></button>)}</div>}
      {Object.keys(tiles).length > 0 && <div className="card stack" style={{ marginTop: 16 }}><h3>Every model</h3>
        <div className="tiles">{Object.entries(tiles).map(([d, img]) => <button key={d} type="button" className="tile" aria-pressed={currentSet?.device === d} onClick={() => setCurrent(d)}><Canvas image={img} /><span>{deviceName(d)}</span></button>)}</div></div>}
    </section>

    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card stack">
        <div className="step"><i>1</i><h2>Design</h2></div>
        <label className={`drop${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => chooseFile(e.target.files?.[0])} />
          {fileUrl ? <img src={fileUrl} alt="" /> : <strong>Drop the design here, or click to choose</strong>}
          <span className="faint">{dims ? `${file?.name}: ${dims.w} x ${dims.h} px${dims.w < 2000 ? " (small: close-ups may look soft)" : ""}` : "PNG, JPG or WebP. Best: portrait 5 : 8, 3000 px wide or more."}</span>
        </label>
      </div>

      <div className="card stack">
        <div className="row between"><div className="step"><i>2</i><h2>Models</h2></div>
          <Button size="small" variant="ghost" onClick={() => { const all = chosen.length !== sets.length; setPicks(Object.fromEntries(sets.map((s) => [s.device, { ...pick(s), on: all }]))) }}>{chosen.length === sets.length ? "Clear all" : "All models"}</Button></div>
        <div className="row">{sets.map((s) => <Chip key={s.device} on={pick(s).on} onClick={() => setPicks((all) => ({ ...all, [s.device]: { ...pick(s), on: !pick(s).on } }))}>{deviceName(s.device)}</Chip>)}</div>
        {chosen.filter((s) => s.colours.length > 1).map((s) => <div key={s.device} className="row between">
          <span className="muted">{deviceName(s.device)}: phone colour</span>
          <div className="row" style={{ gap: 6 }}>{s.colours.map((c) => <button key={c} type="button" className="chip" aria-pressed={pick(s).colour === c} onClick={() => { setPicks((all) => ({ ...all, [s.device]: { ...pick(s), colour: c } })); setCurrent(s.device) }}>{c}</button>)}</div>
        </div>)}
        <p className="faint">The phone colour only changes the phone in the pictures, not what is sold.</p>
        <div><Button size="small" onClick={previewAll} disabled={!file || !chosen.length}>Preview every chosen model</Button></div>
      </div>

      <div className="card stack">
        <div className="row between"><div className="step"><i>3</i><h2>Placement</h2></div><Button size="small" variant="ghost" onClick={() => setPlacement(CENTERED)}>Reset</Button></div>
        <p className="faint">The design covers the whole print, back and sides. Move it if something important sits under the camera hole or on an edge.</p>
        {([["zoom", "Zoom", 100, 250], ["ox", "Left / right", -50, 50], ["oy", "Up / down", -50, 50]] as const).map(([key, label, min, max]) => <label key={key} className="field"><span>{label}</span>
          <input type="range" min={min} max={max} value={Math.round(placement[key] * 100)} disabled={!file} onChange={(e) => setPlacement((p) => ({ ...p, [key]: Number(e.target.value) / 100 }))} /></label>)}
      </div>

      <div className="card stack">
        <div className="step"><i>4</i><h2>Product</h2></div>
        <div className="grid2">
          <Field label="Design name"><input className="input" value={name} maxLength={200} onChange={(e) => { setName(e.target.value); if (!manualSlug) setSlug(slugify(e.target.value)) }} /></Field>
          <Field label="Product URL" hint={`/product/${slug || "your-design"}/`}><input className="input" value={slug} maxLength={150} onChange={(e) => { setSlug(e.target.value); setManualSlug(true) }} /></Field>
          <Field label="Collection"><select className="select" value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="">No collection</option>{collections.map((c) => <option key={c.id} value={c.title}>{c.title}</option>)}<option value={NEW_COLLECTION}>+ New collection...</option></select></Field>
          <Field label="Starting stock (new blanks only)" hint="Existing shared stock is reused."><input className="input" type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
        </div>
        {collection === NEW_COLLECTION && <Field label="New collection name"><input className="input" value={newCollection} maxLength={200} onChange={(e) => setNewCollection(e.target.value)} /></Field>}
        <Field label="Description (optional)"><textarea className="textarea" value={description} maxLength={20000} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>

      <div className="card stack">
        <div className="step"><i>5</i><h2>Publish</h2></div>
        <div className="row">
          <select className="select" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Save as"><option value="draft">Save as draft</option><option value="published">Publish now</option></select>
          <span className="badge">{chosen.length} model{chosen.length === 1 ? "" : "s"} x {settings.shots.length} images</span>
        </div>
        <Button variant="primary" onClick={publish} loading={busy}>{status === "draft" ? "Create draft" : "Publish product"}</Button>
        {progress && <Progress {...progress} />}
      </div>
    </fieldset>
  </div>
}
