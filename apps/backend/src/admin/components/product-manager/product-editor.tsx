import { Badge, Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import ContentPreview from "./content-preview"
import VariantEditor from "./variant-editor"
import RecommendationsEditor from "./recommendations-editor"
import PageContentEditor from "./page-content-editor"
import ReviewsEditor from "./reviews-editor"
import AddRegularVariant from "./add-regular-variant"
import { api, post, Gallery, CatalogCreate, ManagerSelect, useUnsaved, AUDIENCE_OPTIONS, type AudienceTag, type Detail, type Product, type CatalogOption } from "./shared"

export default function ProductEditor({ slug, onBack, onChanged, onDuplicate, onPricing }: { slug: string; onBack: () => void; onChanged: () => void; onDuplicate: (d: Detail) => void; onPricing: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [theme, setTheme] = useState("")
  const [description, setDescription] = useState("")
  const [audience, setAudience] = useState<AudienceTag>("both")
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cases, setCases] = useState<CatalogOption[]>([])
  const [devices, setDevices] = useState<CatalogOption[]>([])
  const [caseSlug, setCaseSlug] = useState("")
  const [deviceSlug, setDeviceSlug] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [variantSearch, setVariantSearch] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<{ product: Product; ids: string[] } | null>(null)
  const [preview, setPreview] = useState(false)
  const [variantPage, setVariantPage] = useState(0)
  const [variantDirty, setVariantDirty] = useState(false)
  const [variantBusy, setVariantBusy] = useState(false)
  const [addDirty, setAddDirty] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [recommendationDirty, setRecommendationDirty] = useState(false)
  const [recommendationBusy, setRecommendationBusy] = useState(false)
  const [contentDirty, setContentDirty] = useState(false)
  const [contentBusy, setContentBusy] = useState(false)
  const lock = useRef(false)
  const dirty = !!d && (name !== d.name || theme !== (d.theme ?? "") || description !== d.products[0]?.description || audience !== (d.audience ?? "both"))
  useUnsaved(dirty || images.length > 0)
  async function catalog() {
    try { const [c, v] = await Promise.all([api("/admin/case-types"), api("/admin/devices")]); setCases(c.case_types); setDevices(v.devices) }
    catch (e: any) { toast.error(`Could not load model selectors: ${e.message}`) }
  }
  const load = useCallback(async (reset = false) => {
    setError("")
    try {
      const r = await api(`/admin/designs/${encodeURIComponent(slug)}`)
      setD(r.design)
      if (reset) { setName(r.design.name); setTheme(r.design.theme ?? ""); setDescription(r.design.products[0]?.description ?? ""); setAudience(r.design.audience ?? "both") }
    } catch (e: any) { setError(e.message) }
  }, [slug])
  useEffect(() => { void load(true); void catalog() }, [load])
  async function run(fn: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await fn() } catch (e: any) { toast.error(e.message) } finally { lock.current = false; setBusy(false) }
  }
  const leave = (next: () => void) => { if (variantBusy || addBusy || recommendationBusy || contentBusy) return; if ((!dirty && !images.length && !variantDirty && !addDirty && !recommendationDirty && !contentDirty) || window.confirm("Discard unsaved product changes?")) next() }
  const openVariants = (product: Product, ids: string[]) => { if (variantBusy) return; if (!variantDirty || window.confirm("Discard unsaved variant or stock changes?")) setEditing({ product, ids }) }
  const saveMeta = () => run(async () => {
    const patch = { ...(name !== d?.name ? { name } : {}), ...(theme !== (d?.theme ?? "") ? { theme } : {}), ...(description !== d?.products[0]?.description ? { description } : {}), ...(audience !== (d?.audience ?? "both") ? { audience } : {}) }
    await api(`/admin/designs/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(patch) })
    toast.success("Product saved."); await load(true); onChanged()
  })
  const changeStatus = (status: string) => run(async () => {
    await api(`/admin/designs/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify({ status }) })
    toast.success(status === "draft" ? "Moved to draft." : "Published."); await load(); onChanged()
  })
  const addPair = () => run(async () => {
    if (!caseSlug || !deviceSlug || !images.length) throw new Error("Choose a case type, model and at least one image.")
    const result = await post(`/admin/designs/${encodeURIComponent(slug)}/pairs`, { pairs: { [caseSlug]: { [deviceSlug]: images } }, blankStock: 0 })
    if (!result.variantsAdded) throw new Error(result.skippedForms?.length ? "This product form could not be added." : "This case type and model already exist. Edit the existing variant instead.")
    toast.success("Variant added. Existing shared stock was kept."); setImages([]); setCaseSlug(""); setDeviceSlug(""); await load(); onChanged()
  })
  const removeProduct = () => leave(() => { if (window.prompt(`Deleting removes this product and its variants. Shared blank stock is kept. Type ${slug} to confirm, or cancel and move it to draft instead.`) === slug) void run(async () => {
    await api(`/admin/designs/${encodeURIComponent(slug)}`, { method: "DELETE" })
    toast.success("Product deleted."); onChanged(); onBack()
  }) })
  if (!d) return <Container><Button variant="secondary" onClick={onBack}>Back</Button>{error ? <div role="alert"><Text>{error}</Text><Button onClick={() => load(true)}>Retry</Button></div> : <Text>Loading product…</Text>}</Container>
  const published = d.products.every((p) => p.status === "published")
  const matching = d.products.flatMap((p) => p.variants.map((v) => ({ p, v }))).filter(({ v }) => `${v.title} ${v.caseType ?? ""} ${v.device ?? ""} ${v.sku ?? ""}`.toLowerCase().includes(variantSearch.toLowerCase()))
  const selectedProduct = d.products.find((p) => selected.length && selected.every((id) => p.variants.some((v) => v.id === id)))
  const editingProduct = d.products.find((p) => p.id === editing?.product.id)
  return <div className="grid gap-5">
    <Container className="flex flex-wrap items-center justify-between gap-3"><div><Button size="small" variant="transparent" disabled={busy || uploading || variantBusy || addBusy || recommendationBusy || contentBusy} onClick={() => leave(onBack)}>← All products</Button><Heading level="h1">{d.name}</Heading><Text size="xsmall" className="text-ui-fg-muted">/product/{d.products[0]?.handle}/</Text></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setPreview(!preview)}>Preview</Button><Button variant="secondary" disabled={busy || uploading || variantBusy || addBusy || recommendationBusy || contentBusy} onClick={() => leave(() => onDuplicate(d))}>Duplicate</Button><Button variant="secondary" disabled={busy || uploading || variantBusy || addBusy || recommendationBusy || contentBusy} onClick={() => changeStatus(published ? "draft" : "published")}>{published ? "Move to draft" : "Publish"}</Button><Button isLoading={busy} disabled={!dirty || uploading || recommendationBusy || contentBusy} onClick={saveMeta}>Save changes</Button></div></Container>
    {preview && <ContentPreview name={name} description={description} variants={d.products.flatMap((p) => p.variants.map((v) => ({ label: v.title, images: v.images.length ? v.images : p.images, price: v.price })))} />}
    {error && <Text role="alert" className="text-ui-fg-error">{error}</Text>}
    <Container className="grid gap-4"><div className="flex flex-wrap gap-2">{d.products.map((p) => <Badge key={p.id} color={p.status === "published" ? "green" : "grey"}>{p.form} · {p.status}</Badge>)}{dirty && <Badge color="orange">Unsaved changes</Badge>}</div><div className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="edit-name">Name</Label><Input id="edit-name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></div><div><Label htmlFor="edit-theme">Collection</Label><Input id="edit-theme" value={theme} onChange={(e) => setTheme(e.target.value)} /></div><div><Label htmlFor="edit-audience">Shown for</Label><ManagerSelect id="edit-audience" aria-label="Shown for" value={audience} onValueChange={(value) => setAudience(value as AudienceTag)}>{AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</ManagerSelect><Text size="xsmall" className="text-ui-fg-muted">{d.kind === "regular" ? "Where this product is listed. Each colour can also be limited under Variants." : "Women only hides it from the Men site (/men); Men only hides it from the Women site."}</Text></div></div><div><Label htmlFor="edit-description">Description</Label><Textarea id="edit-description" maxLength={20000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-3">{d.products.filter((p) => p.status === "published").map((p) => <a key={p.id} className="text-sm text-ui-fg-interactive underline" href={`https://new.florayn.com/product/${encodeURIComponent(p.handle)}/`} target="_blank" rel="noreferrer">View {p.form} on storefront ↗</a>)}{!published && <Text size="small" className="text-ui-fg-muted">Drafts stay private. Review their images and details here before publishing.</Text>}{d.kind === "design" && <Button size="small" variant="secondary" onClick={() => leave(onPricing)}>Manage shared case-type prices</Button>}</div>
    </Container>
    <Container className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><Heading level="h2">Variants</Heading><Input className="max-w-sm" aria-label="Search variants" placeholder="Search model, case type or SKU" value={variantSearch} onChange={(e) => { setVariantSearch(e.target.value); setVariantPage(0) }} /></div>
      <div className="flex flex-wrap gap-2"><Button size="small" variant="secondary" onClick={() => setSelected(matching.map(({ v }) => v.id))}>Select matching variants</Button><Button size="small" variant="secondary" disabled={!selectedProduct} onClick={() => selectedProduct && openVariants(selectedProduct, selected)}>Bulk edit {selected.length || ""}</Button>{selected.length > 0 && <Button size="small" variant="transparent" onClick={() => setSelected([])}>Clear</Button>}</div>
      {selected.length > 0 && !selectedProduct && <Text size="small">Select variants from one product form at a time to bulk edit.</Text>}
      {editing && editingProduct && <VariantEditor key={editing.ids.join("|")} product={editingProduct} variants={editingProduct.variants.filter((v) => editing.ids.includes(v.id))} onDirtyChange={setVariantDirty} onBusyChange={setVariantBusy} slug={slug} onSaved={() => { void load(); onChanged() }} onClose={() => setEditing(null)} />}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{matching.slice(variantPage * 24, variantPage * 24 + 24).map(({ p, v }) => <li key={v.id} className="flex items-center gap-3 rounded-lg border p-3"><input aria-label={`Select ${v.title}`} type="checkbox" checked={selected.includes(v.id)} onChange={(e) => setSelected((all) => e.target.checked ? [...all, v.id] : all.filter((id) => id !== v.id))} /><button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => openVariants(p, [v.id])}>{v.image && <img src={v.image} alt="" loading="lazy" className="h-16 w-12 object-contain" />}<span className="min-w-0 text-sm"><span className="block font-medium">{v.title}</span><span className="block text-xs text-ui-fg-muted">{v.sku || "No SKU"}</span><span className="block text-xs">{v.price == null ? "No BDT price" : `${v.price} BDT`} · {v.images.length} images</span></span></button></li>)}</ul>
      {matching.length > 24 && <div className="flex items-center gap-3"><Button variant="secondary" disabled={variantPage === 0} onClick={() => setVariantPage((p) => p - 1)}>Previous</Button><Text size="small">{variantPage + 1} / {Math.ceil(matching.length / 24)}</Text><Button variant="secondary" disabled={(variantPage + 1) * 24 >= matching.length} onClick={() => setVariantPage((p) => p + 1)}>Next</Button></div>}
    </Container>
    {d.kind === "design" && <Container className="grid gap-4"><Heading level="h2">Add model / case type</Heading><Text size="small">Add one combination with its own gallery. Existing variants keep their IDs and shared stock.</Text><div className="grid gap-3 md:grid-cols-2"><ManagerSelect aria-label="New variant case type" value={caseSlug} onValueChange={(value) => setCaseSlug(value)}><option value="">Choose case type</option>{cases.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</ManagerSelect><ManagerSelect aria-label="New variant model" value={deviceSlug} onValueChange={(value) => setDeviceSlug(value)}><option value="">Choose model</option>{devices.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}</ManagerSelect></div><Gallery images={images} onChange={setImages} slug={slug} disabled={busy} onBusy={setUploading} /><div><Button onClick={addPair} isLoading={busy} disabled={uploading || !caseSlug || !deviceSlug || !images.length}>Add variant</Button></div><CatalogCreate onCreated={catalog} /></Container>}
    {d.kind === "regular" && <RecommendationsEditor key={d.products[0].id} productId={d.products[0].id} disabled={busy || uploading || variantBusy || addBusy} onDirtyChange={setRecommendationDirty} onBusyChange={setRecommendationBusy} />}
    {d.kind === "regular" && <AddRegularVariant onDirtyChange={setAddDirty} onBusyChange={setAddBusy} product={d.products[0]} onSaved={() => { void load(); onChanged() }} />}
    <PageContentEditor products={d.products} disabled={busy || uploading || variantBusy || addBusy || recommendationBusy} onDirtyChange={setContentDirty} onBusyChange={setContentBusy} />
    <ReviewsEditor productId={d.products[0].id} />
    <div><Button variant="danger" disabled={busy || uploading || variantBusy || addBusy || recommendationBusy || contentBusy} onClick={removeProduct}>Delete product</Button></div>
  </div>
}
