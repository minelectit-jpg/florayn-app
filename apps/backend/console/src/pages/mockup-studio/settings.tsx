// Mockup Studio > Settings: the case type the mockups sell, the gallery shots in
// order, and the image size/quality (MOCKUP_STUDIO.md).
import { useEffect, useState } from "react"

import { post } from "../../api"
import { loadMeta, type Settings } from "../../mockup/layers"
import { Button, Chip, Field, toast, useUnsaved } from "../../ui"

type CaseType = { slug: string; name: string; price: number }

export default function StudioSettings({ settings, caseTypes, onSaved }: { settings: Settings; caseTypes: CaseType[]; onSaved: (s: Settings) => void }) {
  const [draft, setDraft] = useState(settings)
  const [quality, setQuality] = useState(String(settings.quality))
  const [names, setNames] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify({ ...draft, quality: Number(quality) }) !== JSON.stringify(settings)
  useUnsaved(dirty)

  // shot names come from the first set's layer info; numbers alone if it cannot be read
  useEffect(() => {
    const set = settings.sets[0]
    if (!set) return
    loadMeta(set.base_url, set.default_colour).then((m) => setNames(Object.fromEntries(m.shots.map((s) => [s.n, s.name.replace(/^\d+\s*/, "")])))).catch(() => setNames({}))
  }, [settings.sets])
  const shots = Object.keys(names).length ? Object.keys(names).map(Number) : Array.from({ length: 13 }, (_, i) => i + 1)

  async function save() {
    setSaving(true)
    try {
      const result = await post<{ settings: Settings }>("/admin/mockups", { ...draft, shots: shots.filter((n) => draft.shots.includes(n)), quality: Number(quality) })
      setDraft(result.settings); onSaved(result.settings)
      toast("Settings saved.", "success")
    } catch (error: any) { toast(error.message, "error") } finally { setSaving(false) }
  }

  const toggle = (n: number) => setDraft((d) => ({ ...d, shots: d.shots.includes(n) ? d.shots.filter((x) => x !== n) : [...d.shots, n] }))
  return <div className="card stack">
    <h2>Settings</h2>
    <div className="grid2">
      <Field label="Case type the mockups show" hint="New products are sold in this case type. The price comes from Case Types.">
        <select className="select" value={draft.case_type} onChange={(e) => setDraft((d) => ({ ...d, case_type: e.target.value }))}>{caseTypes.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></Field>
      <Field label="Product image size" hint="The shop's images are 1200 px.">
        <select className="select" value={draft.image_size} onChange={(e) => setDraft((d) => ({ ...d, image_size: Number(e.target.value) }))}>{[600, 1200, 2400].map((s) => <option key={s} value={s}>{s} x {s} px</option>)}</select></Field>
      <Field label="WebP quality (50-100)" hint="Lower is smaller and loads faster."><input className="input" type="number" min={50} max={100} step={1} value={quality} onChange={(e) => setQuality(e.target.value)} /></Field>
    </div>
    <div className="stack" style={{ gap: 8 }}><strong>Gallery images</strong><p className="faint">In this order on the product page; the first is the main picture.</p>
      <div className="row">{shots.map((n) => <Chip key={n} on={draft.shots.includes(n)} onClick={() => toggle(n)}>{names[n] ?? `Shot ${n}`}</Chip>)}</div></div>
    <div><Button variant="primary" onClick={save} loading={saving} disabled={!dirty || !draft.shots.length}>Save settings</Button></div>
  </div>
}
