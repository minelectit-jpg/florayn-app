// Console > Mockup Studio (MOCKUP_STUDIO.md). New product stays mounted while the
// other tabs are open, so switching tabs or saving Mockup sets keeps the work.
import { useEffect, useState } from "react"

import { api } from "../../api"
import type { Settings } from "../../mockup/layers"
import { Button, Segmented, Skeleton } from "../../ui"
import MockupSets, { type ColourUsage } from "./sets"
import NewProduct, { type Device } from "./new-product"
import StudioSettings from "./settings"

type Data = { settings: Settings; devices: Device[]; case_types: { slug: string; name: string; price: number }[]; colour_usage?: ColourUsage }
type Tab = "new" | "sets" | "settings"

function StudioSkeleton() {
  return <div className="ms ms-skeleton" role="status">
    <span className="sr-only">Loading Mockup Studio…</span>
    <div className="ms-skel-steps">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="dot" />)}</div>
    <div className="split">
      <Skeleton className="sq" />
      <div className="stack">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="ln" />)}</div>
    </div>
  </div>
}

export default function MockupStudio() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<Tab>("new")
  const load = () => { setError(""); api<Data>("/admin/mockups").then(setData).catch((e) => setError(e.message)) }
  useEffect(load, [])
  // a save answers with the settings and, from the sets screen, the colour usage
  const saved = (settings: Settings, colourUsage?: ColourUsage) => setData((d) => (d ? { ...d, settings, colour_usage: colourUsage ?? d.colour_usage } : d))
  const caseTypeName = data?.case_types.find((c) => c.slug === data.settings.case_type)?.name ?? data?.settings.case_type ?? ""

  return <>
    <div className={`page-head${tab === "new" ? " slim" : ""}`}>
      <div><h1>Mockup Studio</h1>{tab !== "new" && <p className="muted">Upload a flat design, pick the models, and every mockup is made for you.</p>}</div>
      <Segmented<Tab> label="Mockup Studio" value={tab} onChange={setTab} options={[["new", "New product"], ["sets", "Mockup sets"], ["settings", "Settings"]]} />
    </div>
    {!data && !error && <StudioSkeleton />}
    {error && <div className="card stack"><p className="note error">{error}</p><div><Button onClick={load}>Try again</Button></div></div>}
    {data && <div className="ms-tab" hidden={tab !== "new"}>
      <NewProduct settings={data.settings} devices={data.devices} caseTypeName={caseTypeName} active={tab === "new"} onOpenSets={() => setTab("sets")} onOpenSettings={() => setTab("settings")} />
    </div>}
    {data && tab === "sets" && <MockupSets settings={data.settings} devices={data.devices} usage={data.colour_usage ?? {}} onSaved={saved} />}
    {data && tab === "settings" && <StudioSettings settings={data.settings} caseTypes={data.case_types} onSaved={saved} />}
  </>
}
