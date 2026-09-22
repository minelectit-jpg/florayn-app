import { Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import type { ProductContent } from "../../../lib/product-content"
import { api, post, ManagerSelect, useUnsaved, type Product } from "./shared"

const headingLabels = { description_heading: "Description heading", information_heading: "Information heading", faq_heading: "FAQ heading", reviews_heading: "Reviews heading", reviews_intro: "Reviews introduction" }
function Form({ productId, disabled, onDirtyChange, onBusyChange }: {
  productId: string; disabled: boolean; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void
}) {
  const [settings, setSettings] = useState<ProductContent | null>(null)
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const lock = useRef(false)
  const dirty = !!settings && JSON.stringify(settings) !== saved
  useUnsaved(dirty)
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  useEffect(() => {
    let active = true
    api(`/admin/products/${productId}/page-content`).then((r) => { if (active) { setSettings(r.settings); setSaved(JSON.stringify(r.settings)); setError("") } }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [productId, retry])
  async function save() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError("")
    try { const r = await post(`/admin/products/${productId}/page-content`, settings); setSettings(r.settings); setSaved(JSON.stringify(r.settings)); toast.success("Product page content saved.") }
    catch (e: any) { setError(e.message) } finally { setBusy(false); lock.current = false }
  }
  if (!settings) return <div><Text>{error || "Loading page content…"}</Text>{error && <Button variant="secondary" onClick={() => setRetry((v) => v + 1)}>Retry</Button>}</div>
  function patch<K extends keyof ProductContent>(key: K, value: ProductContent[K]) { setSettings((s) => s && ({ ...s, [key]: value })) }
  return <fieldset disabled={disabled || busy} className="grid gap-5 disabled:opacity-60">
    <Text size="small" className="text-ui-fg-subtle">Edit the main description above. These settings apply to this product form and all its models. Plain text is shown safely on the storefront.</Text>
    <div className="grid gap-3 md:grid-cols-2">{Object.entries(headingLabels).map(([key, label]) => <div key={key}><Label htmlFor={`page-${key}`}>{label}</Label><Input id={`page-${key}`} maxLength={key === "reviews_intro" ? 300 : 80} value={settings[key as keyof typeof headingLabels]} onChange={(e) => patch(key as keyof typeof headingLabels, e.target.value)} /></div>)}</div>
    <section className="grid gap-3 rounded-lg border p-4">
      <Heading level="h3">Additional information</Heading>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.facts === null} onChange={(e) => patch("facts", e.target.checked ? null : [])} />Use automatic product information</label>
      <Text size="xsmall" className="text-ui-fg-subtle">Automatic information uses the product's collection, models and case types. Turn it off to choose your own rows. An empty custom list hides this section.</Text>
      {settings.facts?.map((row, i) => <div key={i} className="grid gap-2 rounded border p-3">
        <Input aria-label={`Detail ${i + 1} label`} placeholder="Label, e.g. Material" maxLength={80} value={row.label} onChange={(e) => patch("facts", settings.facts!.map((r, n) => n === i ? { ...r, label: e.target.value } : r))} />
        <Textarea aria-label={`Detail ${i + 1} value`} placeholder="Value" maxLength={500} value={row.value} onChange={(e) => patch("facts", settings.facts!.map((r, n) => n === i ? { ...r, value: e.target.value } : r))} />
        <div className="flex gap-2"><Button size="small" variant="secondary" disabled={i === 0} onClick={() => { const rows = [...settings.facts!]; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; patch("facts", rows) }}>Move up</Button><Button size="small" variant="transparent" onClick={() => patch("facts", settings.facts!.filter((_, n) => n !== i))}>Remove</Button></div>
      </div>)}
      {settings.facts && <div><Button variant="secondary" disabled={settings.facts.length >= 16} onClick={() => patch("facts", [...settings.facts!, { label: "", value: "" }])}>Add information row</Button></div>}
    </section>
    <section className="grid gap-3 rounded-lg border p-4">
      <Heading level="h3">Product FAQ</Heading>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.faqs === null} onChange={(e) => patch("faqs", e.target.checked ? null : [])} />Use standard product FAQs</label>
      <Text size="xsmall" className="text-ui-fg-subtle">Standard FAQs cover selecting an option, Cash on Delivery, checkout charges and contacting support. Turn this off to write product-specific answers. An empty custom list hides FAQs.</Text>
      {settings.faqs?.map((row, i) => <div key={i} className="grid gap-2 rounded border p-3">
        <Input aria-label={`FAQ ${i + 1} question`} placeholder="Question" maxLength={200} value={row.question} onChange={(e) => patch("faqs", settings.faqs!.map((r, n) => n === i ? { ...r, question: e.target.value } : r))} />
        <Textarea aria-label={`FAQ ${i + 1} answer`} placeholder="Answer" rows={3} maxLength={2000} value={row.answer} onChange={(e) => patch("faqs", settings.faqs!.map((r, n) => n === i ? { ...r, answer: e.target.value } : r))} />
        <div className="flex gap-2"><Button size="small" variant="secondary" disabled={i === 0} onClick={() => { const rows = [...settings.faqs!]; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; patch("faqs", rows) }}>Move up</Button><Button size="small" variant="transparent" onClick={() => patch("faqs", settings.faqs!.filter((_, n) => n !== i))}>Remove</Button></div>
      </div>)}
      {settings.faqs && <div><Button variant="secondary" disabled={settings.faqs.length >= 12} onClick={() => patch("faqs", [...settings.faqs!, { question: "", answer: "" }])}>Add FAQ</Button></div>}
    </section>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.reviews_enabled} onChange={(e) => patch("reviews_enabled", e.target.checked)} />Show customer reviews and accept signed-in customer submissions</label>
    <Text size="small">Review text and ratings belong to customers. Use Product reviews to approve, hide or reply to them. Reviews are shared across the same design's models and product forms.</Text>
    {error && <Text role="alert" className="text-ui-fg-error">{error}</Text>}
    <div className="flex gap-2"><Button disabled={!dirty} isLoading={busy} onClick={save}>Save page content</Button><Button variant="secondary" disabled={!dirty} onClick={() => setSettings(JSON.parse(saved))}>Discard changes</Button></div>
  </fieldset>
}
export default function PageContentEditor({ products, disabled, onDirtyChange, onBusyChange }: {
  products: Product[]; disabled: boolean; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void
}) {
  const [productId, setProductId] = useState(products[0].id)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  return <Container className="grid gap-4">
    <Heading level="h2">Product page content</Heading>
    {products.length > 1 && <fieldset disabled={busy || disabled}><Label htmlFor="page-content-product">Product form</Label><ManagerSelect id="page-content-product" value={productId} onValueChange={(id) => { if (!dirty || window.confirm("Discard unsaved page content changes?")) setProductId(id) }}>{products.map((p) => <option key={p.id} value={p.id}>{p.form} — {p.title}</option>)}</ManagerSelect></fieldset>}
    <Form key={productId} productId={productId} disabled={disabled} onDirtyChange={setDirty} onBusyChange={setBusy} />
  </Container>
}

