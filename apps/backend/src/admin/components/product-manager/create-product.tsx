import { Badge, Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { api, post, slugify, Gallery, CatalogCreate, ManagerSelect, useUnsaved, type CatalogOption, type Detail } from "./shared"

import ContentPreview from "./content-preview"

type Pair = { key: number; caseSlug: string; deviceSlug: string; images: string[] }
type RegularRow = { options: Record<string, string>; sku: string; price: string; stock: string; images: string[] }
const emptyRegular = (): RegularRow => ({ options: { Option: "Default" }, sku: "", price: "", stock: "0", images: [] })

export default function CreateProduct({ duplicate, onBack, onCreated }: { duplicate?: Detail; onBack: () => void; onCreated: (slug: string) => void }) {
  const [kind, setKind] = useState<"design" | "regular">(duplicate?.kind ?? "design")
  const [name, setName] = useState(duplicate ? `${duplicate.name} copy` : "")
  const [slug, setSlug] = useState(duplicate ? `${duplicate.slug}-copy` : "")
  const [manualSlug, setManualSlug] = useState(false)
  const [description, setDescription] = useState(duplicate?.products[0]?.description ?? "")
  const [theme, setTheme] = useState(duplicate?.theme ?? "")
  const [status, setStatus] = useState("draft")
  const [stock, setStock] = useState("0")
  const [cases, setCases] = useState<CatalogOption[]>([])
  const [devices, setDevices] = useState<CatalogOption[]>([])
  const [catalogError, setCatalogError] = useState("")
  const [pairs, setPairs] = useState<Pair[]>(() => duplicate?.kind === "design" ? duplicate.products.flatMap((p) => p.variants).map((v, i) => ({ key: i, caseSlug: v.caseTypeSlug ?? "", deviceSlug: v.deviceSlug ?? "", images: v.images })) : [{ key: 0, caseSlug: "", deviceSlug: "", images: [] }])
  const nextKey = useRef(pairs.length)
  const [options, setOptions] = useState(() => duplicate?.kind === "regular" ? duplicate.products[0].options.map((o) => ({ title: o.title, values: o.values.join(", ") })) : [{ title: "Option", values: "Default" }])
  const [rows, setRows] = useState<RegularRow[]>(() => duplicate?.kind === "regular" ? duplicate.products[0].variants.map((v, i) => ({ options: v.options, sku: `${duplicate.slug}-copy-${i + 1}`.toUpperCase(), price: String(v.price ?? ""), stock: "0", images: v.images.length ? v.images : duplicate.products[0].images })) : [emptyRegular()])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [page, setPage] = useState(0)
  const [review, setReview] = useState(false)
  const lock = useRef(false)
  useUnsaved(Boolean(name || pairs.some((p) => p.images.length) || rows.some((r) => r.images.length)))

  async function catalog() {
    setCatalogError("")
    try {
      const [c, d] = await Promise.all([api("/admin/case-types"), api("/admin/devices")])
      setCases(c.case_types); setDevices(d.devices)
      if (duplicate?.kind === "design") setPairs((current) => current.map((p, i) => {
        const source = duplicate.products.flatMap((product) => product.variants)[i]
        return source ? { ...p, caseSlug: p.caseSlug || c.case_types.find((v: CatalogOption) => v.name === source.caseType)?.slug || "", deviceSlug: p.deviceSlug || d.devices.find((v: CatalogOption) => v.name === source.device)?.slug || "" } : p
      }))
    } catch (error: any) { setCatalogError(error.message) }
  }
  useEffect(() => { void catalog() }, [])
  const updatePair = (key: number, patch: Partial<Pair>) => setPairs((current) => current.map((p) => p.key === key ? { ...p, ...patch } : p))
  const updateRow = (i: number, patch: Partial<RegularRow>) => setRows((current) => current.map((row, n) => n === i ? { ...row, ...patch } : row))
  function generate() {
    try {
      if (options.some((o) => !o.title.trim() || !o.values.trim()) || new Set(options.map((o) => o.title.trim())).size !== options.length) throw new Error("Enter unique option names and at least one value per option.")
      let combinations: Record<string, string>[] = [{}]
      for (const option of options) {
        const values = [...new Set(option.values.split(",").map((v) => v.trim()).filter(Boolean))]
        if (combinations.length * values.length > 200) throw new Error("Use up to 200 variants. Reduce the option values.")
        combinations = combinations.flatMap((c) => values.map((v) => ({ ...c, [option.title.trim()]: v })))
      }
      const key = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort())
      const nextKeys = new Set(combinations.map(key))
      if (rows.some((r) => !nextKeys.has(key(r.options)) && (r.images.length || r.price)) && !window.confirm("Some unsaved variants will be removed by these options. Continue?")) return
      setRows(combinations.map((o, i) => rows.find((r) => key(r.options) === key(o)) ?? { options: o, sku: `${slug || "PRODUCT"}-${i + 1}`.toUpperCase(), price: "", stock: "0", images: [] }))
      setPage(0)
    } catch (error: any) { toast.error(error.message) }
  }
  function payload() {
    if (!name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Enter a product name and a valid URL.")
    if (kind === "design") {
      const qty = Number(stock)
      if (!stock.trim() || !Number.isSafeInteger(qty) || qty < 0) throw new Error("Enter a whole starting stock quantity, including zero.")
      const map: Record<string, Record<string, string[]>> = {}
      for (const p of pairs) {
        if (!p.caseSlug || !p.deviceSlug || !p.images.length) throw new Error("Every combination needs a case type, model and at least one image.")
        map[p.caseSlug] ??= {}
        if (map[p.caseSlug][p.deviceSlug]) throw new Error("A case type and model combination appears twice.")
        map[p.caseSlug][p.deviceSlug] = p.images
      }
      if (!pairs.length) throw new Error("Add at least one combination.")
      return { name, slug, description, theme, status, blankStock: qty, pairs: map }
    }
    const definitions = options.map((o) => ({ title: o.title.trim(), values: [...new Set(o.values.split(",").map((v) => v.trim()).filter(Boolean))] }))
    if (rows.some((r) => !r.price.trim() || !r.stock.trim())) throw new Error("Enter a price and stock for every variant. Zero is allowed.")
    if (rows.some((r) => Object.keys(r.options).length !== definitions.length || definitions.some((o) => !o.values.includes(r.options[o.title])))) throw new Error("Update the variants after changing option names or values.")
    return { name, slug, description, status, options: definitions, variants: rows.map((r, i) => ({ ...r, sku: r.sku.trim() || `${slug}-${i + 1}`.toUpperCase(), price: Number(r.price), stock: Number(r.stock) })) }
  }
  async function save() {
    if (lock.current || uploading) return
    lock.current = true; setBusy(true)
    try {
      const result = await post(kind === "design" ? "/admin/designs/custom" : "/admin/designs/regular", payload())
      toast.success(status === "draft" ? "Draft created." : "Product published.")
      onCreated(result.result?.design ?? result.result?.slug ?? slug)
    } catch (error: any) { toast.error(error.message) } finally { lock.current = false; setBusy(false) }
  }
  const count = kind === "design" ? pairs.length : rows.length
  return <Container className="p-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4"><div><Heading level="h1">{duplicate ? "Duplicate product" : "Create product"}</Heading><Text size="small" className="text-ui-fg-subtle">Start with one variant. Add more whenever you need.</Text></div><Button variant="secondary" disabled={busy || uploading} onClick={() => { if (!name || window.confirm("Leave this unsaved product?")) onBack() }}>Back to products</Button></div>
    <fieldset disabled={busy || uploading} className="grid gap-6 p-6">
      {!duplicate && <div className="flex gap-2"><Button variant={kind === "design" ? "primary" : "secondary"} onClick={() => { setKind("design"); setPage(0) }}>Case / design product</Button><Button variant={kind === "regular" ? "primary" : "secondary"} onClick={() => { setKind("regular"); setPage(0) }}>Regular product</Button></div>}
      <div className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="pm-name">Product name</Label><Input id="pm-name" value={name} maxLength={200} onChange={(e) => { setName(e.target.value); if (!manualSlug) setSlug(slugify(e.target.value)) }} /></div><div><Label htmlFor="pm-slug">Product URL</Label><Input id="pm-slug" value={slug} maxLength={150} onChange={(e) => { setSlug(e.target.value); setManualSlug(true) }} /><Text size="xsmall" className="text-ui-fg-muted">/product/{slug || "your-product"}/</Text></div></div>
      <div><Label htmlFor="pm-description">Description</Label><Textarea id="pm-description" rows={4} value={description} maxLength={20000} onChange={(e) => setDescription(e.target.value)} /></div>
      {kind === "design" ? <>
        {catalogError && <div role="alert"><Text className="text-ui-fg-error">{catalogError}</Text><Button variant="secondary" onClick={catalog}>Retry loading models</Button></div>}
        <div className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="pm-theme">Collection</Label><Input id="pm-theme" value={theme} onChange={(e) => setTheme(e.target.value)} /></div><div><Label htmlFor="pm-stock">Starting stock for new blanks only</Label><Input id="pm-stock" type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} /><Text size="xsmall" className="text-ui-fg-muted">Existing shared stock is reused. This does not add stock to an existing blank.</Text></div></div>
        <CatalogCreate onCreated={catalog} />
        <Text size="small">Prices come from Case Types and stay the same across designs. Only the combinations below will be sold.</Text>
        {pairs.slice(page * 10, page * 10 + 10).map((pair) => <div key={pair.key} className="grid gap-3 rounded-xl border border-ui-border-base p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><ManagerSelect aria-label="Case type" value={pair.caseSlug} onValueChange={(value) => updatePair(pair.key, { caseSlug: value })}><option value="">Choose case type</option>{cases.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</ManagerSelect><ManagerSelect aria-label="Model" value={pair.deviceSlug} onValueChange={(value) => updatePair(pair.key, { deviceSlug: value })}><option value="">Choose model</option>{devices.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</ManagerSelect><Button variant="transparent" onClick={() => { setPairs((all) => all.filter((p) => p.key !== pair.key)); setPage(0) }}>Remove combination</Button></div>
          <Gallery images={pair.images} onChange={(images) => updatePair(pair.key, { images })} slug={slug} onBusy={setUploading} />
        </div>)}
        <Button variant="secondary" onClick={() => { const key = nextKey.current++; setPairs((current) => [...current, { key, caseSlug: "", deviceSlug: "", images: [] }]); setPage(Math.floor(pairs.length / 10)) }}>Add model / case type</Button>
      </> : <>
        <Text size="small">Leave Option / Default for a single product. For variants, enter options such as Color: Black, White or Size: S, M.</Text>
        {options.map((o, i) => <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"><Input aria-label={`Option ${i + 1} name`} value={o.title} onChange={(e) => setOptions((all) => all.map((x, n) => n === i ? { ...x, title: e.target.value } : x))} /><Input aria-label={`Option ${i + 1} values`} value={o.values} placeholder="Values separated by commas" onChange={(e) => setOptions((all) => all.map((x, n) => n === i ? { ...x, values: e.target.value } : x))} /><Button variant="transparent" disabled={options.length === 1} onClick={() => setOptions((all) => all.filter((_, n) => n !== i))}>Remove option</Button></div>)}
        <div className="flex gap-2"><Button variant="secondary" disabled={options.length >= 3} onClick={() => setOptions((all) => [...all, { title: "", values: "" }])}>Add option</Button><Button variant="secondary" onClick={generate}>Update variants</Button></div>
        {rows.slice(page * 10, page * 10 + 10).map((row, offset) => { const i = page * 10 + offset; return <div key={i} className="grid gap-3 rounded-xl border border-ui-border-base p-4">
          <div className="flex justify-between"><Heading level="h3">{Object.values(row.options).join(" / ")}</Heading><Button variant="transparent" disabled={rows.length === 1} onClick={() => { setRows((all) => all.filter((_, n) => n !== i)); setPage(0) }}>Remove variant</Button></div>
          <div className="grid gap-3 md:grid-cols-3"><div><Label>SKU</Label><Input aria-label={`SKU ${i + 1}`} value={row.sku} placeholder={`${slug || "PRODUCT"}-${i + 1}`.toUpperCase()} onChange={(e) => updateRow(i, { sku: e.target.value })} /></div><div><Label>Price (BDT)</Label><Input aria-label={`Price ${i + 1}`} type="number" min={0} step="0.01" value={row.price} onChange={(e) => updateRow(i, { price: e.target.value })} /></div><div><Label>Stock</Label><Input aria-label={`Stock ${i + 1}`} type="number" min={0} step={1} value={row.stock} onChange={(e) => updateRow(i, { stock: e.target.value })} /></div></div>
          <Gallery images={row.images} onChange={(images) => updateRow(i, { images })} slug={slug} onBusy={setUploading} />
          <Button variant="transparent" onClick={() => setRows((all) => all.map((r) => ({ ...r, price: row.price, images: [...row.images] })))}>Use this price and gallery for all variants</Button>
        </div> })}
      </>}
      {count > 10 && <div className="flex items-center gap-3"><Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button><Text size="small">{page + 1} / {Math.ceil(count / 10)}</Text><Button variant="secondary" disabled={(page + 1) * 10 >= count} onClick={() => setPage((p) => p + 1)}>Next</Button></div>}
      <div className="flex flex-wrap items-end gap-3 border-t pt-4"><div><Label htmlFor="pm-status">Save as</Label><ManagerSelect id="pm-status" value={status} onValueChange={(value) => setStatus(value)}><option value="draft">Draft</option><option value="published">Published</option></ManagerSelect></div><Badge>{count} variant{count === 1 ? "" : "s"}</Badge><Button variant="secondary" onClick={() => { try { payload(); setReview(!review) } catch (error: any) { toast.error(error.message) } }}>Review product</Button><Button isLoading={busy} onClick={save}>{status === "draft" ? "Create draft" : "Publish product"}</Button></div>
      {review && <ContentPreview name={name} description={description} variants={kind === "design" ? pairs.map((p) => ({ label: [cases.find((c) => c.slug === p.caseSlug)?.name, devices.find((d) => d.slug === p.deviceSlug)?.name].filter(Boolean).join(" / "), images: p.images, price: cases.find((c) => c.slug === p.caseSlug)?.price })) : rows.map((r) => ({ label: Object.values(r.options).join(" / "), images: r.images, price: r.price.trim() ? Number(r.price) : null }))} />}
    </fieldset>
  </Container>
}
