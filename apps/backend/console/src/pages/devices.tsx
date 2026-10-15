// Console > Models: add a phone/AirPods/watch model, turn models on or off in the
// store, and set the badge shown next to a model (e.g. New). Same endpoints as
// the classic Devices page (/admin/devices).
import { useEffect, useState } from "react"

import { api, post } from "../api"
import { sortNewestFirst } from "../../../src/lib/device-order"
import { Button, Field, toast, Toggle } from "../ui"

type Device = { id: string; slug: string; name: string; family: string; is_active: boolean; badge?: string | null }
const FAMILIES: [string, string][] = [["iphone", "iPhone"], ["samsung", "Samsung"], ["airpods", "AirPods"], ["watch", "Apple Watch"], ["wallet", "Wallets"]]
const BADGE_MAX = 12

export default function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [badges, setBadges] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [family, setFamily] = useState("iphone")
  const [show, setShow] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = () => api<{ devices: Device[] }>("/admin/devices").then((d) => setDevices(d.devices)).catch((e) => toast(e.message, "error"))
  useEffect(() => { void load() }, [])

  async function add() {
    const clean = name.trim()
    if (!clean) return toast("Enter the model name, e.g. iPhone 18 Pro Max.", "error")
    if (devices?.some((d) => d.name.toLowerCase() === clean.toLowerCase())) return toast(`${clean} is already on the list.`, "error")
    setAdding(true)
    try {
      await post("/admin/devices", { name: clean, family, is_active: show })
      toast(`${clean} added${show ? " and shown in the store" : ". It stays hidden from the store until you switch it on"}.`, "success")
      setName(""); setShow(false)
      await load()
    } catch (error: any) { toast(error.message, "error") } finally { setAdding(false) }
  }

  async function update(d: Device, patch: Partial<Device>) {
    setBusy(d.id)
    try {
      const { device } = await post<{ device: Device }>(`/admin/devices/${d.id}`, patch)
      setDevices((all) => all?.map((x) => (x.id === d.id ? { ...x, ...device } : x)) ?? null)
    } catch (error: any) { toast(error.message, "error") } finally { setBusy(null) }
  }

  function saveBadge(d: Device) {
    const next = (badges[d.id] ?? d.badge ?? "").trim()
    if (next === (d.badge ?? "")) return
    void update(d, { badge: next || null })
  }

  const ordered = devices ? sortNewestFirst(devices, (d) => d.name, (d) => d.family) : []
  const shown = devices?.filter((d) => d.is_active).length ?? 0
  return <>
    <div className="page-head"><div><h1>Models</h1><p className="muted">Every model the store can sell a case for. Each brand is listed newest first, read from the name.</p></div>
      {devices && <span className="badge">{shown} of {devices.length} shown in the store</span>}</div>

    <div className="card stack">
      <h2>Add a model</h2>
      <div className="grid2">
        <Field label="Model name"><input className="input" value={name} maxLength={80} placeholder="iPhone 18 Pro Max" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add() }} /></Field>
        <Field label="Type"><select className="select" value={family} onChange={(e) => setFamily(e.target.value)}>{FAMILIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <div className="row"><Toggle checked={show} onChange={setShow} label="Show in the store now" /><span>Show in the store now</span></div>
      <p className="faint">Leave it off until the model has products, so the menu never lists a model with nothing to buy. Switch it on below later.</p>
      <div><Button variant="primary" loading={adding} onClick={add}>Add model</Button></div>
    </div>

    {FAMILIES.map(([key, label]) => {
      const items = ordered.filter((d) => d.family === key)
      if (!items.length) return null
      return <div key={key} className="card stack" style={{ gap: 6 }}>
        <h2>{label}</h2>
        {items.map((d) => <div key={d.id} className="row" style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
          <span style={{ flex: 1, minWidth: 160, color: d.is_active ? "var(--ink)" : "var(--ink-faint)" }}>{d.name}{!d.is_active && " (hidden)"}</span>
          <input className="input" style={{ width: 120, minHeight: 34, padding: "5px 10px" }} aria-label={`${d.name} badge`} placeholder="Badge" maxLength={BADGE_MAX}
            value={badges[d.id] ?? d.badge ?? ""} onChange={(e) => setBadges((b) => ({ ...b, [d.id]: e.target.value }))}
            onBlur={() => saveBadge(d)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} disabled={busy === d.id} />
          <Toggle checked={d.is_active} onChange={(v) => update(d, { is_active: v })} label={`${d.name} shown in the store`} />
        </div>)}
      </div>
    })}
    {!devices && <p className="muted">Loading models...</p>}
  </>
}
