// Mockup Studio > Mockup sets: upload a model's packed Blender layers to R2 and
// choose which models the studio offers (MOCKUP_STUDIO.md).
import { useState } from "react"

import { post } from "../../api"
import { blobToBase64, loadMeta, type MockupSet, type Settings } from "../../mockup/layers"
import { Button, Field, Progress, toast, Toggle, useUnsaved } from "../../ui"
import type { Device } from "./new-product"

type Plan = { colours: string[]; files: { file: File; key: string; type: string }[]; bytes: number; sizes: number[] }
const COLOUR = /^[A-Za-z0-9][A-Za-z0-9 ()+.-]{0,39}$/

/** Finds <colour>/meta.json in the chosen folder and the PNGs of the sizes the studio uses. */
async function planUpload(files: File[], device: string, imageSize: number): Promise<Plan> {
  const rel = (f: File) => ((f as any).webkitRelativePath || f.name).split("/") as string[]
  const metas = files.filter((f) => rel(f).at(-1) === "meta.json" && rel(f).length >= 2)
  if (!metas.length) throw new Error("No layer set in that folder. Choose the model's folder, e.g. D:\\Florayn mockup layers\\iPhone 18 Pro Max.")
  const version = `v${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}`
  const plan: Plan = { colours: [], files: [], bytes: 0, sizes: [] }
  for (const metaFile of metas) {
    const parts = rel(metaFile)
    const colour = parts[parts.length - 2]
    if (!COLOUR.test(colour)) throw new Error(`Rename the colour folder "${colour}" to letters, numbers and spaces.`)
    const root = parts.slice(0, -1).join("/")
    const meta = JSON.parse(await metaFile.text())
    const sizes: number[] = [...meta.sizes].sort((a: number, b: number) => a - b)
    // the smallest size feeds the live previews, the other one the product images
    const wanted = new Set([sizes[0], sizes.filter((s) => s <= imageSize).pop() ?? sizes[0]])
    plan.sizes = [...wanted]
    plan.colours.push(colour)
    const prefix = `mockups/${device}/${version}/${colour}`
    plan.files.push({ file: metaFile, key: `${prefix}/meta.json`, type: "application/json" })
    for (const f of files) {
      const p = rel(f)
      if (p.slice(0, -2).join("/") !== root || !wanted.has(Number(p[p.length - 2])) || !/^\d\d [a-z]+\.png$/.test(p[p.length - 1])) continue
      plan.files.push({ file: f, key: `${prefix}/${p[p.length - 2]}/${p[p.length - 1]}`, type: "image/png" })
    }
  }
  plan.bytes = plan.files.reduce((n, f) => n + f.file.size, 0)
  plan.colours.sort((a, b) => (a === "Black" ? -1 : b === "Black" ? 1 : a.localeCompare(b)))
  return plan
}

export default function MockupSets({ settings, devices, onSaved }: { settings: Settings; devices: Device[]; onSaved: (s: Settings) => void }) {
  const [sets, setSets] = useState<MockupSet[]>(settings.sets)
  const [device, setDevice] = useState("")
  const [plan, setPlan] = useState<Plan | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [checks, setChecks] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(sets) !== JSON.stringify(settings.sets)
  useUnsaved(dirty || Boolean(progress))
  const deviceName = (slug: string) => devices.find((d) => d.slug === slug)?.name ?? slug

  async function save(next: MockupSet[]) {
    setSaving(true)
    try {
      const result = await post<{ settings: Settings }>("/admin/mockups", { ...settings, sets: next })
      setSets(result.settings.sets); onSaved(result.settings)
      toast("Mockup sets saved.", "success")
      return true
    } catch (error: any) { toast(error.message, "error"); return false } finally { setSaving(false) }
  }

  async function choose(files: FileList | null) {
    setPlan(null)
    if (!files?.length) return
    if (!device) return toast("Choose the model first.", "error")
    try { setPlan(await planUpload([...files], device, settings.image_size)) } catch (error: any) { toast(error.message, "error") }
  }

  async function upload() {
    if (!plan || progress) return
    const queue = [...plan.files]
    const urls = new Map<string, string>()
    let done = 0
    setProgress({ done, total: queue.length })
    try {
      const worker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const body = { key: item.key, mimeType: item.type, contentBase64: await blobToBase64(item.file) }
          const result = await post<{ url: string }>("/admin/r2/upload", body).catch(() => post<{ url: string }>("/admin/r2/upload", body))
          urls.set(item.key, result.url)
          setProgress({ done: ++done, total: plan.files.length })
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      const colour = plan.colours[0]
      const metaUrl = urls.get(plan.files.find((f) => f.key.endsWith(`/${colour}/meta.json`))!.key)!
      const base = metaUrl.slice(0, metaUrl.length - `/${encodeURIComponent(colour)}/meta.json`.length)
      const old = sets.find((s) => s.device === device)
      const set: MockupSet = {
        device, base_url: base, colours: plan.colours, enabled: old?.enabled ?? true,
        default_colour: old && plan.colours.includes(old.default_colour) ? old.default_colour : plan.colours[0],
      }
      if (await save([...sets.filter((s) => s.device !== device), set])) { setPlan(null); void check(set) }
    } catch (error: any) {
      toast(`Upload stopped: ${error.message}. Choose the folder again to retry.`, "error")
    } finally { setProgress(null) }
  }

  async function check(set: MockupSet) {
    setChecks((c) => ({ ...c, [set.device]: "Checking..." }))
    try {
      for (const colour of set.colours) await loadMeta(set.base_url, colour)
      setChecks((c) => ({ ...c, [set.device]: "OK: every colour can be read." }))
    } catch (error: any) { setChecks((c) => ({ ...c, [set.device]: error.message })) }
  }

  const update = (slug: string, patch: Partial<MockupSet>) => setSets((all) => all.map((s) => (s.device === slug ? { ...s, ...patch } : s)))
  return <>
    <div className="card stack">
      <div><h2>Models with mockups</h2><p className="faint">Only models switched on here appear in New product.</p></div>
      {!sets.length && <p className="muted">None yet. Upload a model's layers below.</p>}
      {sets.map((s) => <div key={s.device} className="stack" style={{ gap: 8, padding: 14, border: "1px solid var(--line)", borderRadius: 12 }}>
        <div className="row">
          <Toggle checked={s.enabled} onChange={(enabled) => update(s.device, { enabled })} label={`${deviceName(s.device)} on`} />
          <strong style={{ flex: 1 }}>{deviceName(s.device)}</strong>
          <select className="select" style={{ width: 170 }} aria-label="Default phone colour" value={s.default_colour} onChange={(e) => update(s.device, { default_colour: e.target.value })}>{s.colours.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <Button size="small" onClick={() => check(s)}>Check</Button>
          <Button size="small" variant="ghost" onClick={() => { if (window.confirm(`Remove ${deviceName(s.device)} from Mockup Studio? Products already made keep their images.`)) setSets((all) => all.filter((x) => x.device !== s.device)) }}>Remove</Button>
        </div>
        <div className="row" style={{ gap: 6 }}>{s.colours.map((c) => <span key={c} className="badge">{c}{c === s.default_colour ? " (default)" : ""}</span>)}</div>
        {checks[s.device] && <p className={checks[s.device].startsWith("OK") ? "faint" : "note error"}>{checks[s.device]}</p>}
      </div>)}
      {dirty && <div><Button variant="primary" loading={saving} onClick={() => save(sets)}>Save changes</Button></div>}
    </div>

    <div className="card stack">
      <div><h2>Upload a model's layers</h2><p className="faint">Choose the model, then its folder from the Blender pipeline (one folder per phone colour inside). Uploading again replaces that model's set. A model that is not listed yet is added under <a href="#/models">Models</a>.</p></div>
      <fieldset disabled={Boolean(progress)} className="grid2" style={{ border: 0, padding: 0, margin: 0 }}>
        <Field label="Model"><select className="select" value={device} onChange={(e) => { setDevice(e.target.value); setPlan(null) }}><option value="">Choose model</option>{devices.map((d) => <option key={d.slug} value={d.slug}>{d.name}{d.is_active ? "" : " (hidden in store)"}</option>)}</select></Field>
        <Field label="Layer folder"><input className="input" type="file" multiple {...({ webkitdirectory: "", directory: "" } as any)} onChange={(e) => choose(e.target.files)} /></Field>
      </fieldset>
      {plan && <div className="stack">
        <p>{plan.colours.length} colour{plan.colours.length === 1 ? "" : "s"} ({plan.colours.join(", ")}), sizes {plan.sizes.join(" + ")} px: {plan.files.length} files, {(plan.bytes / 1048576).toFixed(1)} MB.</p>
        <div><Button variant="primary" onClick={upload} loading={Boolean(progress)}>Upload to R2</Button></div>
        {progress && <Progress {...progress} label="Uploading" />}
      </div>}
    </div>
  </>
}
