import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Swatch } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import NewDesignPage from "../new-design/page"
import CaseTypesPage from "../case-types/page"
import CreateProduct from "../../components/product-manager/create-product"
import ProductEditor from "../../components/product-manager/product-editor"
import { api, ManagerSelect, type Detail } from "../../components/product-manager/shared"

type Summary = { slug: string; name: string; theme: string | null; thumbnail: string | null; forms: string[]; variantCount: number; status: string; kind: "design" | "regular" }

const ProductManagerPage = () => {
  const [params, setParams] = useSearchParams()
  const slug = params.get("slug")
  const mode = params.get("mode") ?? "products"
  const [designs, setDesigns] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [kind, setKind] = useState("")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [duplicate, setDuplicate] = useState<Detail>()
  const lock = useRef(false)
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { const r = await api("/admin/designs/live"); setDesigns(r.designs ?? []) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const visible = useMemo(() => designs.filter((d) => (!status || d.status === status) && (!kind || d.kind === kind) && `${d.name} ${d.slug} ${d.theme ?? ""}`.toLowerCase().includes(search.toLowerCase().trim())), [designs, search, status, kind])
  async function bulkStatus(next: string) {
    if (lock.current) return
    lock.current = true; setBusy(true)
    let saved = 0
    try {
      for (const id of selected) {
        await api(`/admin/designs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: next }) })
        saved++; setSelected((all) => all.filter((s) => s !== id))
      }
      toast.success(`${saved} products updated.`)
    } catch (e: any) { toast.error(`${saved} saved. ${e.message}`) }
    finally { lock.current = false; setBusy(false); void load() }
  }
  const home = () => { setDuplicate(undefined); setParams({}); void load() }
  if (mode === "create") return <CreateProduct key={duplicate?.slug ?? "new"} duplicate={duplicate} onBack={home} onCreated={(id) => { setDuplicate(undefined); setParams({ slug: id }); void load() }} />
  if (slug) return <ProductEditor key={slug} slug={slug} onBack={home} onChanged={load} onDuplicate={(d) => { setDuplicate(d); setParams({ mode: "create" }) }} onPricing={() => setParams({ mode: "pricing" })} />
  return <div className="grid gap-5">
    <Container className="flex flex-wrap items-center justify-between gap-4"><div><Heading level="h1">Product Manager</Heading><Text size="small" className="text-ui-fg-subtle">Create, edit and organize every product from one place.</Text></div><Button onClick={() => { setDuplicate(undefined); setParams({ mode: "create" }) }}>Create product</Button></Container>
    <nav aria-label="Product management" className="flex flex-wrap gap-2">{[["products", "All products"], ["bulk", "Bulk upload"], ["pricing", "Case-type pricing"]].map(([value, label]) => <Button key={value} variant={mode === value ? "primary" : "secondary"} onClick={() => setParams(value === "products" ? {} : { mode: value })}>{label}</Button>)}</nav>
    {mode === "bulk" ? <NewDesignPage /> : mode === "pricing" ? <CaseTypesPage /> : <Container className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]"><Input aria-label="Search products" placeholder="Search name, URL or collection" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} /><ManagerSelect aria-label="Filter status" value={status} onValueChange={(value) => { setStatus(value); setPage(0) }}><option value="">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="mixed">Mixed</option></ManagerSelect><ManagerSelect aria-label="Filter product type" value={kind} onValueChange={(value) => { setKind(value); setPage(0) }}><option value="">All product types</option><option value="design">Case / design</option><option value="regular">Regular product</option></ManagerSelect></div>
      {selected.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ui-bg-subtle p-3"><Text size="small">{selected.length} selected</Text><Button size="small" disabled={busy} onClick={() => bulkStatus("published")}>Publish selected</Button><Button size="small" variant="secondary" disabled={busy} onClick={() => bulkStatus("draft")}>Move to draft</Button><Button size="small" variant="transparent" disabled={busy} onClick={() => setSelected([])}>Clear selection</Button></div>}
      {error ? <div role="alert"><Text className="text-ui-fg-error">{error}</Text><Button variant="secondary" onClick={load}>Retry</Button></div> : loading ? <Text>Loading products…</Text> : <>
        <Text size="small" className="text-ui-fg-subtle">{visible.length} products · {designs.filter((d) => d.status === "draft").length} drafts</Text>
        {!visible.length && <Text>No products match these filters.</Text>}
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{visible.slice(page * 24, page * 24 + 24).map((d) => <li key={d.slug} className="overflow-hidden rounded-xl border border-ui-border-base">
          <button type="button" className="block w-full text-left" onClick={() => setParams({ slug: d.slug })}><div className="aspect-square bg-ui-bg-subtle">{d.thumbnail && <img src={d.thumbnail} alt={d.name} loading="lazy" className="size-full object-contain" />}</div><div className="grid gap-2 p-3"><span className="font-medium">{d.name}</span><span className="text-xs text-ui-fg-muted">{d.kind === "regular" ? "Regular product" : d.forms.join(" · ")} · {d.variantCount} variants</span></div></button>
          <div className="flex items-center justify-between border-t px-3 py-2"><label className="flex items-center gap-2 text-xs"><input aria-label={`Select ${d.name}`} type="checkbox" disabled={busy} checked={selected.includes(d.slug)} onChange={(e) => setSelected((all) => e.target.checked ? [...all, d.slug] : all.filter((s) => s !== d.slug))} />Select</label><Badge color={d.status === "published" ? "green" : "grey"}>{d.status}</Badge></div>
        </li>)}</ul>
        {visible.length > 24 && <div className="flex items-center justify-between"><Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button><Text size="small">Page {page + 1} of {Math.ceil(visible.length / 24)}</Text><Button variant="secondary" disabled={(page + 1) * 24 >= visible.length} onClick={() => setPage((p) => p + 1)}>Next</Button></div>}
      </>}
    </Container>}
  </div>
}

export const config = defineRouteConfig({ label: "Product Manager", icon: Swatch })
export default ProductManagerPage
