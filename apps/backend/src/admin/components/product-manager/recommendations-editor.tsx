import { Button, Container, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { api, post, ManagerSelect, useUnsaved } from "./shared"

type Settings = { recommended: string[]; featured: string[] }
type Choice = { id: string; title: string; product_title: string; image?: string | null; status?: string }
type Product = { id: string; title: string }
const EMPTY: Settings = { recommended: [], featured: [] }
const LABELS = { recommended: "Recommended for you", featured: "We think you'll love" }

export default function RecommendationsEditor({ productId, disabled, onDirtyChange, onBusyChange }: {
  productId: string; disabled: boolean; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void
}) {
  const [settings, setSettings] = useState<Settings>(EMPTY)
  const [saved, setSaved] = useState("")
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [query, setQuery] = useState("")
  const [products, setProducts] = useState<Product[]>([])
  const [product, setProduct] = useState("")
  const [variants, setVariants] = useState<Choice[]>([])
  const [variant, setVariant] = useState("")
  const [variantQuery, setVariantQuery] = useState("")
  const [variantPage, setVariantPage] = useState(0)
  const [variantCount, setVariantCount] = useState(0)
  const [section, setSection] = useState<keyof Settings>("recommended")
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const dirty = !!saved && JSON.stringify(settings) !== saved
  useUnsaved(dirty)
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  useEffect(() => {
    let active = true
    api(`/admin/products/${productId}/recommendations`).then((data) => {
      if (!active) return
      setSettings(data.settings); setSaved(JSON.stringify(data.settings))
      setChoices(Object.fromEntries(data.choices.map((c: Choice) => [c.id, c]))); setError("")
    }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [productId, retry])
  useEffect(() => {
    const abort = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      api(`/admin/products?limit=20&status[]=published&fields=id,title&q=${encodeURIComponent(query.trim())}`, { signal: abort.signal })
        .then((data) => { if (!abort.signal.aborted) setProducts(data.products.filter((p: Product) => p.id !== productId)) })
        .catch((e) => { if (!abort.signal.aborted) setError(e.message) })
        .finally(() => { if (!abort.signal.aborted) setSearching(false) })
    }, 250)
    return () => { clearTimeout(timer); abort.abort() }
  }, [query, productId])
  useEffect(() => {
    setVariant(""); setVariants([])
    if (!product) return
    const abort = new AbortController()
    const timer = setTimeout(() => { api(`/admin/products/${product}/variants?limit=20&offset=${variantPage * 20}&q=${encodeURIComponent(variantQuery)}&fields=id,title,metadata`, { signal: abort.signal }).then((data) => {
      if (abort.signal.aborted) return
      const title = products.find((p) => p.id === product)?.title ?? ""
      const rows = data.variants.map((v: any) => ({ id: v.id, title: v.title, product_title: title, image: v.metadata?.images?.[0], status: "published" }))
      setVariants(rows); setVariant(rows[0]?.id ?? ""); setVariantCount(data.count ?? rows.length)
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message) }) }, 200)
    return () => { clearTimeout(timer); abort.abort() }
  }, [product, variantQuery, variantPage])
  function add() {
    const choice = variants.find((v) => v.id === variant)
    if (!choice || settings[section].includes(variant) || settings[section].length >= 8) return
    setChoices((all) => ({ ...all, [variant]: choice }))
    setSettings((all) => ({ ...all, [section]: [...all[section], variant] }))
  }
  function move(key: keyof Settings, index: number, step: number) {
    setSettings((all) => {
      const ids = [...all[key]]
      ;[ids[index], ids[index + step]] = [ids[index + step], ids[index]]
      return { ...all, [key]: ids }
    })
  }
  async function save() {
    setBusy(true); setError("")
    try {
      const data = await post(`/admin/products/${productId}/recommendations`, settings)
      setSaved(JSON.stringify(data.settings)); setSettings(data.settings)
      toast.success("Product recommendations saved.")
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <Container className="grid gap-5">
    <div><Heading level="h2">Product recommendations</Heading><Text size="small" className="text-ui-fg-subtle">Choose each section separately. Select the exact model or colour customers should see. Up to 8 items per section; an empty section stays hidden.</Text></div>
    {error && <div role="alert"><Text className="text-ui-fg-error">{error}</Text>{!saved && <Button variant="secondary" onClick={() => setRetry((v) => v + 1)}>Retry</Button>}</div>}
    <fieldset disabled={disabled || busy || !saved} className="grid min-w-0 gap-5">
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label htmlFor="recommendation-search">Find a product</Label><Input id="recommendation-search" value={query} placeholder="Search published products" onChange={(e) => { setQuery(e.target.value); setProduct("") }} /></div>
        <div><Label>Product</Label><ManagerSelect aria-label="Recommendation product" value={product} onValueChange={(id) => { setProduct(id); setVariantQuery(""); setVariantPage(0) }}><option value="">{searching ? "Searching…" : "Choose a product"}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</ManagerSelect></div>
        <div><Label>Model / option</Label><ManagerSelect aria-label="Recommendation variant" value={variant} onValueChange={setVariant}><option value="">Choose a variant</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</ManagerSelect></div>
        <div><Label>Add to section</Label><ManagerSelect aria-label="Recommendation section" value={section} onValueChange={(value) => setSection(value as keyof Settings)}>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</ManagerSelect></div>
      </div>
      {product && <div className="flex flex-wrap items-end gap-2"><div className="max-w-sm flex-1"><Label htmlFor="recommendation-variant-search">Find a model / option</Label><Input id="recommendation-variant-search" value={variantQuery} placeholder="Search models, colours or sizes" onChange={(e) => { setVariantQuery(e.target.value); setVariantPage(0) }} /></div>{variantCount > 20 && <><Button variant="secondary" disabled={variantPage === 0} onClick={() => setVariantPage((p) => p - 1)}>Previous options</Button><Text size="small">{variantPage + 1} / {Math.ceil(variantCount / 20)}</Text><Button variant="secondary" disabled={(variantPage + 1) * 20 >= variantCount} onClick={() => setVariantPage((p) => p + 1)}>Next options</Button></>}</div>}
      <div><Button variant="secondary" disabled={!variant || settings[section].includes(variant) || settings[section].length >= 8} onClick={add}>Add to section</Button></div>
      <div className="grid gap-5 lg:grid-cols-2">{(["recommended", "featured"] as const).map((key) => <section key={key} className="rounded-lg border p-4">
        <Heading level="h3">{LABELS[key]} · {settings[key].length}/8</Heading>
        {!settings[key].length && <Text size="small" className="mt-3 text-ui-fg-muted">No products selected.</Text>}
        <ol className="mt-3 grid gap-3">{settings[key].map((id, index) => {
          const c = choices[id]
          return <li key={id} className="flex flex-wrap items-center gap-2 rounded-md bg-ui-bg-subtle p-2">
            {c?.image && <img src={c.image} alt="" className="size-10 rounded object-contain" loading="lazy" />}
            <div className="min-w-0 flex-1"><Text size="small" weight="plus">{c?.product_title || "Unavailable product"}</Text><Text size="xsmall" className="text-ui-fg-subtle">{c?.title || "Remove this selection"}{c?.status && c.status !== "published" ? " · Hidden (draft)" : ""}</Text></div>
            <div className="flex gap-1"><Button size="small" variant="secondary" aria-label={`Move ${c?.product_title ?? "item"} up in ${LABELS[key]}`} disabled={index === 0} onClick={() => move(key, index, -1)}>↑</Button><Button size="small" variant="secondary" aria-label={`Move ${c?.product_title ?? "item"} down in ${LABELS[key]}`} disabled={index === settings[key].length - 1} onClick={() => move(key, index, 1)}>↓</Button><Button size="small" variant="transparent" onClick={() => setSettings((all) => ({ ...all, [key]: all[key].filter((v) => v !== id) }))}>Remove</Button></div>
          </li>
        })}</ol>
      </section>)}</div>
      <div className="flex gap-2"><Button isLoading={busy} disabled={!dirty} onClick={save}>Save recommendations</Button><Button variant="secondary" disabled={!dirty} onClick={() => setSettings(JSON.parse(saved))}>Discard changes</Button></div>
    </fieldset>
  </Container>
}
