import { Button, Container, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { api, post, useUnsaved } from "./product-manager/shared"
export default function BundleBadgeEditor() {
  const [text, setText] = useState("")
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useUnsaved(saved !== null && text !== saved)
  useEffect(() => {
    let active = true
    api("/admin/bundles/badge").then((data) => { if (active) { setText(data.text); setSaved(data.text); setError("") } }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [retry])
  async function save() {
    setBusy(true); setError("")
    try { const data = await post("/admin/bundles/badge", { text }); setText(data.text); setSaved(data.text); toast.success("Bundle badge saved.") }
    catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <Container className="grid gap-3">
    <Heading level="h2">Bundle/pack badge</Heading>
    <Text size="small" className="text-ui-fg-subtle">Show a short offer beside the Bundle/pack tab. Leave blank to calculate the savings from your active offers. This label does not change prices or discounts.</Text>
    <Label htmlFor="bundle-badge">Badge text</Label><Input id="bundle-badge" className="max-w-md" maxLength={32} value={text} disabled={saved === null || busy} placeholder="e.g. Up to 20% off" onChange={(e) => setText(e.target.value)} />
    <Text size="small">Preview: <span className="font-medium">Bundle/pack</span> <span className="rounded bg-ui-bg-highlight px-2 py-1">{text.trim() || "Automatic savings"}</span></Text>
    {error && <Text role="alert" className="text-ui-fg-error">{error}</Text>}
    <div>{saved === null ? <Button variant="secondary" onClick={() => setRetry((v) => v + 1)}>Reload badge</Button> : <Button disabled={text === saved} isLoading={busy} onClick={save}>Save badge</Button>}</div>
  </Container>
}
