// Mockup Studio > Mockup sets: which phone models the studio offers, their phone
// colours (the shop's palette: names, dot colours and the default colour) and a
// check that the browser can read their layers. A model's layers come from the
// Blender pipeline and are put on R2 once (MOCKUP_STUDIO.md, PHONE_COLOURS.md);
// there is nothing to upload here.
import { useState, type CSSProperties } from "react"

import { post } from "../../api"
import { loadMeta, type MockupSet, type Settings } from "../../mockup/layers"
import { Button, Icon, IconButton, slugify, toast, Toggle, useUnsaved } from "../../ui"
import type { Device } from "./new-product"
import { HEX, swatchHex } from "./wizard/state"

/** device slug -> colour web name -> phone colour picture rows (one per variant), from /admin/mockups. */
export type ColourUsage = Record<string, Record<string, number>>

/** Own keys only: "constructor" is a valid colour web name. */
const own = (o: object | undefined, key: string) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, key)
/** The picture rows of one model's colour. */
const usedBy = (usage: ColourUsage, device: string, colour: string) => {
  const byColour = usage[device], key = slugify(colour)
  return byColour && own(byColour, key) ? byColour[key] : 0
}

/** A hex field that commits a valid #rrggbb on blur or Enter and goes back to the saved value otherwise. */
function HexField({ value, label, onCommit }: { value: string; label: string; onCommit: (hex: string) => void }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setText(value) } // the picker changed it
  const commit = () => {
    const v = text.trim().replace(/^([0-9a-f]{6})$/i, "#$1")
    if (HEX.test(v)) { if (v.toLowerCase() !== value) onCommit(v.toLowerCase()); else setText(value) } else setText(value)
  }
  return <input className="input ms-hex" value={text} maxLength={7} spellCheck={false} autoComplete="off" aria-label={label}
    onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit() } }} />
}

export default function MockupSets({ settings, devices, usage, onSaved }: {
  settings: Settings; devices: Device[]; usage: ColourUsage; onSaved: (s: Settings, usage?: ColourUsage) => void
}) {
  const [sets, setSets] = useState<MockupSet[]>(settings.sets)
  const [checks, setChecks] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(sets) !== JSON.stringify(settings.sets)
  useUnsaved(dirty)
  const deviceName = (slug: string) => devices.find((d) => d.slug === slug)?.name ?? slug

  async function save() {
    setSaving(true)
    try {
      const result = await post<{ settings: Settings; colour_usage?: ColourUsage }>("/admin/mockups", { ...settings, sets })
      setSets(result.settings.sets); onSaved(result.settings, result.colour_usage)
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
  const setHex = (s: MockupSet, c: string, hex: string) => update(s.device, { swatches: { ...(s.swatches ?? {}), [c]: hex } })
  function removeColour(s: MockupSet, c: string) {
    if (c === s.default_colour || s.colours.length < 2) return
    const used = usedBy(usage, s.device, c)
    if (used && !window.confirm(`${c} is used by ${used.toLocaleString("en-US")} designs' pictures. They will stop showing ${c}. Remove it?`)) return
    const swatches = { ...(s.swatches ?? {}) }
    delete swatches[c]
    update(s.device, { colours: s.colours.filter((x) => x !== c), swatches: Object.keys(swatches).length ? swatches : undefined })
  }

  return <div className="card stack">
    <div className="stack" style={{ gap: 4 }}>
      <h2>Models with mockups</h2>
      <p className="faint">Switch a model off to leave it out of New product. Its colours are the phone colours shoppers can pick, with the dot colour they see.</p>
      <p className="faint">The phone colour only changes the pictures. Shoppers pick it on the product page and in the shop.</p>
    </div>
    {!sets.length && <p className="muted">No model has mockups yet.</p>}
    {sets.map((s) => {
      const model = deviceName(s.device)
      return <div key={s.device} className="stack ms-set">
        <div className="row">
          <Toggle checked={s.enabled} onChange={(enabled) => update(s.device, { enabled })} label={`${model} on`} />
          <strong style={{ flex: 1 }}>{model}</strong>
          <Button size="small" onClick={() => check(s)}>Check</Button>
        </div>
        <label className="field ms-set-default"><span>Default phone colour (shop and main picture)</span>
          <select className="select" value={s.default_colour} onChange={(e) => update(s.device, { default_colour: e.target.value })}>{s.colours.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <ul className="ms-colours" aria-label={`Phone colours of ${model}`}>
          {s.colours.map((c) => {
            const hex = swatchHex(s, c)
            const saved = own(s.swatches, c) && Boolean(s.swatches?.[c])
            const used = usedBy(usage, s.device, c)
            const locked = c === s.default_colour || s.colours.length < 2
            return <li key={c} className="ms-colour" title={used ? `${c}: pictures of ${used.toLocaleString("en-US")} designs` : c}>
              <label className="ms-colour-pick" style={{ "--sw": hex } as CSSProperties}>
                <input type="color" className="sr-only" value={hex} aria-label={`Dot colour of ${c}`} onChange={(e) => setHex(s, c, e.target.value)} /><i />
              </label>
              <span className="ms-colour-name">{c}{c === s.default_colour && <span className="badge purple">Default</span>}</span>
              <HexField value={hex} label={`Dot colour of ${c} (hex)`} onCommit={(v) => setHex(s, c, v)} />
              {!saved && <span className="faint">suggested</span>}
              <IconButton className="sm" icon={Icon.close} aria-disabled={locked || undefined}
                label={c === s.default_colour ? `Remove ${c} (choose another default colour first)` : s.colours.length < 2 ? `Remove ${c} (a model keeps one colour)` : `Remove ${c}`}
                onClick={() => removeColour(s, c)} />
            </li>
          })}
        </ul>
        {checks[s.device] && <p className={checks[s.device].startsWith("OK") ? "faint" : "note error"}>{checks[s.device]}</p>}
      </div>
    })}
    {dirty && <div><Button variant="primary" loading={saving} onClick={save}>Save changes</Button></div>}
  </div>
}
