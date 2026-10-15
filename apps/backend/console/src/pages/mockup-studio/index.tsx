// Console > Mockup Studio (MOCKUP_STUDIO.md).
import { useEffect, useState } from "react"

import { api } from "../../api"
import type { Settings } from "../../mockup/layers"
import { Button, Segmented } from "../../ui"
import MockupSets from "./sets"
import NewProduct, { type Device } from "./new-product"
import StudioSettings from "./settings"

type Data = { settings: Settings; devices: Device[]; case_types: { slug: string; name: string; price: number }[] }
type Tab = "new" | "sets" | "settings"

export default function MockupStudio() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<Tab>("new")
  const load = () => { setError(""); api<Data>("/admin/mockups").then(setData).catch((e) => setError(e.message)) }
  useEffect(load, [])
  const saved = (settings: Settings) => setData((d) => (d ? { ...d, settings } : d))

  return <>
    <div className="page-head">
      <div><h1>Mockup Studio</h1><p className="muted">Upload a flat design, pick the models, and every mockup is made for you.</p></div>
      <Segmented<Tab> value={tab} onChange={setTab} options={[["new", "New product"], ["sets", "Mockup sets"], ["settings", "Settings"]]} />
    </div>
    {error && <div className="card stack"><p className="note error">{error}</p><div><Button onClick={load}>Try again</Button></div></div>}
    {data && tab === "new" && <NewProduct key={data.settings.sets.map((s) => `${s.device}:${s.base_url}:${s.enabled}`).join("|")} settings={data.settings} devices={data.devices} />}
    {data && tab === "sets" && <MockupSets settings={data.settings} devices={data.devices} onSaved={saved} />}
    {data && tab === "settings" && <StudioSettings settings={data.settings} caseTypes={data.case_types} onSaved={saved} />}
  </>
}
