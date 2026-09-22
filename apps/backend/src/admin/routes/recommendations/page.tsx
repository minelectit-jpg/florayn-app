import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Label, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { api, ManagerSelect, post, useUnsaved } from "../../components/product-manager/shared"

type Settings = { phone_model: string; phone_case_type: string; airpods_model: string; airpods_case_type: string }
type Device = { id: string; name: string; family: string }
type CaseType = { name: string; devices: Device[] }

const RecommendationsPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState("")
  const [devices, setDevices] = useState<Device[]>([])
  const [caseTypes, setCaseTypes] = useState<CaseType[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const dirty = !!settings && JSON.stringify(settings) !== saved
  useUnsaved(dirty)
  async function load() {
    setError("")
    try {
      const data = await api("/admin/content/recommendations")
      setSettings(data.settings); setSaved(JSON.stringify(data.settings))
      setDevices(data.devices); setCaseTypes(data.caseTypes)
    } catch (e: any) { setError(e.message) }
  }
  useEffect(() => { void load() }, [])
  async function save() {
    if (busy || !settings) return
    setBusy(true); setError("")
    try {
      const data = await post("/admin/content/recommendations", settings)
      setSettings(data.settings); setSaved(JSON.stringify(data.settings))
      toast.success("Recommendation defaults saved")
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <Container className="space-y-6">
    <div><Heading level="h1">Matching recommendations</Heading><Text className="text-ui-fg-subtle">Choose the default models for Recommended for you and the Matching Set. Both always use the same artwork as the product being viewed.</Text></div>
    {error ? <div role="alert"><Text className="text-ui-fg-error">{error}</Text>{!settings ? <Button onClick={load}>Retry</Button> : null}</div> : null}
    {!settings ? <Text>Loading settings…</Text> : <>
      <fieldset disabled={busy} className="grid gap-6 md:grid-cols-2">
        {(["phone", "airpods"] as const).map((form) => {
          const models = devices.filter((d) => form === "phone" ? ["iphone", "samsung"].includes(d.family) : d.family === "airpods")
          const selected = models.find((d) => d.name === settings[`${form}_model`])
          const types = caseTypes.filter((c) => c.devices.some((d) => d.id === selected?.id))
          return <div key={form} className="space-y-3 rounded-lg border border-ui-border-base p-4">
            <Heading level="h2">{form === "phone" ? "On AirPods pages: matching phone case" : "On phone pages: matching AirPods case"}</Heading>
            <Label htmlFor={`${form}-model`}>Default model</Label>
            <ManagerSelect id={`${form}-model`} value={settings[`${form}_model`]} onValueChange={(value) => {
              const model = models.find((d) => d.name === value)
              const fits = caseTypes.filter((c) => c.devices.some((d) => d.id === model?.id))
              setSettings({ ...settings, [`${form}_model`]: value, [`${form}_case_type`]: fits.some((c) => c.name === settings[`${form}_case_type`]) ? settings[`${form}_case_type`] : fits[0]?.name ?? "" })
            }}>
              {!selected ? <option value={settings[`${form}_model`]}>{settings[`${form}_model`]} (unavailable)</option> : null}
              {models.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </ManagerSelect>
            <Label htmlFor={`${form}-case`}>Default case type</Label>
            <ManagerSelect id={`${form}-case`} value={settings[`${form}_case_type`]} onValueChange={(value) => setSettings({ ...settings, [`${form}_case_type`]: value })}>
              {!types.some((c) => c.name === settings[`${form}_case_type`]) ? <option value={settings[`${form}_case_type`]}>{settings[`${form}_case_type`] || "Choose case type"} (unavailable)</option> : null}
              {types.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </ManagerSelect>
          </div>
        })}
      </fieldset>
      <Text size="small" className="text-ui-fg-subtle">If a design does not support the default model, we use an available model from that category. AirPods Max and other AirPods models belong to the same AirPods category.</Text>
      <div className="flex justify-end"><Button onClick={save} isLoading={busy} disabled={!dirty}>Save defaults</Button></div>
    </>}
    <div className="border-t border-ui-border-base pt-4"><Text>Choose and reorder designs in <Link className="underline" to="/featured-picks">We think you'll love</Link>. Those designs follow the current page's model and category. Manage offer prices in <Link className="underline" to="/bundles">Bundles</Link>.</Text></div>
  </Container>
}
export const config = defineRouteConfig({ label: "Matching recommendations" })
export default RecommendationsPage
