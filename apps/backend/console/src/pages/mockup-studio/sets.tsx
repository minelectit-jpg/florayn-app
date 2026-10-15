// Mockup Studio > Mockup sets: which phone models the studio offers, their
// default phone colour, and a check that the browser can read their layers.
// A model's layers come from the Blender pipeline and are put on R2 once
// (MOCKUP_STUDIO.md); there is nothing to upload here.
import { useState } from "react"

import { post } from "../../api"
import { loadMeta, type MockupSet, type Settings } from "../../mockup/layers"
import { Button, toast, Toggle, useUnsaved } from "../../ui"
import type { Device } from "./new-product"

export default function MockupSets({ settings, devices, onSaved }: { settings: Settings; devices: Device[]; onSaved: (s: Settings) => void }) {
  const [sets, setSets] = useState<MockupSet[]>(settings.sets)
  const [checks, setChecks] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(sets) !== JSON.stringify(settings.sets)
  useUnsaved(dirty)
  const deviceName = (slug: string) => devices.find((d) => d.slug === slug)?.name ?? slug

  async function save() {
    setSaving(true)
    try {
      const result = await post<{ settings: Settings }>("/admin/mockups", { ...settings, sets })
      setSets(result.settings.sets); onSaved(result.settings)
      toast("Mockup sets saved.", "success")
    } catch (error: any) { toast(error.message, "error") } finally { setSaving(false) }
  }

  async function check(set: MockupSet) {
    setChecks((c) => ({ ...c, [set.device]: "Checking..." }))
    try {
      for (const colour of set.colours) await loadMeta(set.base_url, colour)
      setChecks((c) => ({ ...c, [set.device]: "OK: every colour can be read." }))
    } catch (error: any) { setChecks((c) => ({ ...c, [set.device]: error.message })) }
  }

  const update = (slug: string, patch: Partial<MockupSet>) => setSets((all) => all.map((s) => (s.device === slug ? { ...s, ...patch } : s)))
  return <div className="card stack">
    <div><h2>Models with mockups</h2><p className="faint">Switch a model off to leave it out of New product. The default colour is the phone shown in the pictures unless you pick another.</p></div>
    {!sets.length && <p className="muted">No model has mockups yet.</p>}
    {sets.map((s) => <div key={s.device} className="stack" style={{ gap: 8, padding: 14, border: "1px solid var(--line)", borderRadius: 12 }}>
      <div className="row">
        <Toggle checked={s.enabled} onChange={(enabled) => update(s.device, { enabled })} label={`${deviceName(s.device)} on`} />
        <strong style={{ flex: 1 }}>{deviceName(s.device)}</strong>
        <select className="select" style={{ width: 170 }} aria-label="Default phone colour" value={s.default_colour} onChange={(e) => update(s.device, { default_colour: e.target.value })}>{s.colours.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <Button size="small" onClick={() => check(s)}>Check</Button>
      </div>
      <div className="row" style={{ gap: 6 }}>{s.colours.map((c) => <span key={c} className="badge">{c}{c === s.default_colour ? " (default)" : ""}</span>)}</div>
      {checks[s.device] && <p className={checks[s.device].startsWith("OK") ? "faint" : "note error"}>{checks[s.device]}</p>}
    </div>)}
    {dirty && <div><Button variant="primary" loading={saving} onClick={save}>Save changes</Button></div>}
  </div>
}
