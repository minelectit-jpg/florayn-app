import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Swatch, ArrowLeft } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  StatusBadge,
  Text,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"

type Status = "published" | "draft" | "mixed"
type DesignSummary = {
  slug: string
  name: string
  theme: string | null
  thumbnail: string | null
  forms: string[]
  productCount: number
  variantCount: number
  status: Status
}
type VariantDetail = { id: string; caseType: string | null; device: string | null; image: string | null }
type ProductDetail = {
  id: string
  handle: string
  title: string
  form: string
  status: string
  thumbnail: string | null
  caseTypes: string[]
  devices: string[]
  variants: VariantDetail[]
}
type DesignDetail = {
  slug: string
  name: string
  theme: string | null
  collection: { id: string; title: string } | null
  products: ProductDetail[]
}
type Option = { slug: string; name: string }

const STATUS_COLOR: Record<Status, "green" | "grey" | "orange"> = { published: "green", draft: "grey", mixed: "orange" }
const FORM_LABEL: Record<string, string> = { phone: "Phone", airpods: "AirPods", watch: "Watch", wallet: "Wallet" }

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: "include", headers: { "content-type": "application/json" }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || "Request failed.")
  return data
}

async function readFileBase64(file: File): Promise<{ contentBase64: string; mimeType: string; filename: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ contentBase64: String(reader.result).split(",")[1] ?? "", mimeType: file.type || "image/webp", filename: file.name })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const ProductManagerPage = () => {
  const [params, setParams] = useSearchParams()
  const slug = params.get("slug")
  const [designs, setDesigns] = useState<DesignSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api("/admin/designs/live")
      setDesigns(d.designs ?? [])
    } catch (e: any) {
      toast.error(e?.message || "Could not load products.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return designs
    return designs.filter((d) => d.name.toLowerCase().includes(q) || (d.theme ?? "").toLowerCase().includes(q))
  }, [designs, search])

  if (slug) {
    return <DesignDetailView slug={slug} onBack={() => setParams({})} onChanged={load} />
  }

  return (
    <Container className="p-0 divide-y">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <Heading level="h1">Product Manager</Heading>
          <Text size="small" className="text-ui-fg-subtle">Every design and product in the store — edit, publish, or remove.</Text>
        </div>
        <Link to="/new-design">
          <Button size="small" variant="secondary">Upload / new design</Button>
        </Link>
      </div>
      <div className="px-6 py-3">
        <Input size="small" placeholder="Search by name or theme…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>
      <div className="px-6 py-5">
        {loading ? (
          <div className="py-16 text-center text-ui-fg-subtle">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-ui-fg-subtle">{designs.length ? "No matches." : "No products yet."}</div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((d) => (
              <li key={d.slug}>
                <button
                  type="button"
                  onClick={() => setParams({ slug: d.slug })}
                  className="block w-full overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base text-left transition-shadow hover:shadow-elevation-card-hover"
                >
                  <span className="block aspect-square overflow-hidden bg-ui-bg-subtle">
                    {d.thumbnail ? <img src={d.thumbnail} alt={d.name} className="size-full object-cover" /> : null}
                  </span>
                  <span className="block px-3 py-2.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ui-fg-base">{d.name}</span>
                      <StatusBadge color={STATUS_COLOR[d.status]}>{d.status}</StatusBadge>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {d.forms.map((f) => <Badge key={f} size="2xsmall">{FORM_LABEL[f] ?? f}</Badge>)}
                      <span className="text-xs text-ui-fg-muted">· {d.variantCount} variant{d.variantCount === 1 ? "" : "s"}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Container>
  )
}

function DesignDetailView({ slug, onBack, onChanged }: { slug: string; onBack: () => void; onChanged: () => void }) {
  const [d, setD] = useState<DesignDetail | null>(null)
  const [name, setName] = useState("")
  const [theme, setTheme] = useState("")
  const [busy, setBusy] = useState(false)

  const [caseTypes, setCaseTypes] = useState<Option[]>([])
  const [devices, setDevices] = useState<Option[]>([])
  const [addCt, setAddCt] = useState("")
  const [addDev, setAddDev] = useState("")
  const [addFile, setAddFile] = useState<File | null>(null)
  // Inline "create new case type / model".
  const [newCt, setNewCt] = useState<{ name: string; price: string } | null>(null)
  const [newDev, setNewDev] = useState<{ name: string; family: string } | null>(null)

  const loadDetail = useCallback(async () => {
    try {
      const r = await api(`/admin/designs/${slug}`)
      setD(r.design)
      setName(r.design?.name ?? "")
      setTheme(r.design?.theme ?? "")
    } catch (e: any) {
      toast.error(e?.message || "Could not load the design.")
    }
  }, [slug])
  const loadCatalog = useCallback(async () => {
    try {
      const [ct, dv] = await Promise.all([api("/admin/case-types"), api("/admin/devices")])
      setCaseTypes((ct.case_types ?? []).map((c: any) => ({ slug: c.slug, name: c.name })))
      setDevices((dv.devices ?? []).map((v: any) => ({ slug: v.slug, name: v.name })))
    } catch {
      /* leave selectors empty */
    }
  }, [])
  useEffect(() => { loadDetail() }, [loadDetail])
  useEffect(() => { loadCatalog() }, [loadCatalog])

  const isPublished = d?.products.every((p) => p.status === "published") ?? false

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e: any) { toast.error(e?.message || `${label} failed.`) } finally { setBusy(false) }
  }

  const saveMeta = () => run("Save", async () => {
    await api(`/admin/designs/${slug}`, { method: "PATCH", body: JSON.stringify({ name, theme }) })
    toast.success("Saved"); await loadDetail(); onChanged()
  })
  const setStatus = (status: "published" | "draft") => run("Status", async () => {
    await api(`/admin/designs/${slug}`, { method: "PATCH", body: JSON.stringify({ status }) })
    toast.success(status === "published" ? "Published" : "Unpublished"); await loadDetail(); onChanged()
  })
  const remove = () => run("Delete", async () => {
    if (!window.confirm(`Delete "${d?.name}" and all its products? This cannot be undone.`)) return
    await api(`/admin/designs/${slug}`, { method: "DELETE" })
    toast.success("Deleted"); onChanged(); onBack()
  })
  const addPair = () => run("Add", async () => {
    if (!addCt || !addDev || !addFile) { toast.error("Pick a case type, a model and an image."); return }
    const f = await readFileBase64(addFile)
    const up = await api("/admin/designs/upload", { method: "POST", body: JSON.stringify({ designSlug: slug, caseTypeSlug: addCt, deviceSlug: addDev, index: 1, ...f }) })
    const r = await api(`/admin/designs/${slug}/pairs`, { method: "POST", body: JSON.stringify({ pairs: { [addCt]: { [addDev]: [up.url] } } }) })
    if (r.variantsAdded) toast.success(`Added ${r.variantsAdded} variant`)
    else if (r.skippedForms?.length) toast.error("This design has no product for that form yet — upload it first.")
    else toast.error("That case type + model already exists.")
    setAddFile(null); await loadDetail(); onChanged()
  })
  const createCaseType = () => run("Create case type", async () => {
    const r = await api("/admin/case-types", { method: "POST", body: JSON.stringify({ name: newCt?.name, price: Number(newCt?.price) }) })
    toast.success(`Created "${r.case_type?.name}"`)
    await loadCatalog(); setAddCt(r.case_type?.slug ?? ""); setNewCt(null)
  })
  const createDevice = () => run("Create model", async () => {
    const r = await api("/admin/devices", { method: "POST", body: JSON.stringify({ name: newDev?.name, family: newDev?.family }) })
    toast.success(`Created "${r.device?.name}"`)
    await loadCatalog(); setAddDev(r.device?.slug ?? ""); setNewDev(null)
  })

  return (
    <Container className="p-0 divide-y">
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <Button size="small" variant="transparent" onClick={onBack}><ArrowLeft className="mr-1" /> Back</Button>
          <div>
            <Heading level="h1">{d?.name ?? "Design"}</Heading>
            <Text size="xsmall" className="text-ui-fg-muted">/{slug}</Text>
          </div>
        </div>
        {d ? (
          <div className="flex items-center gap-2">
            {isPublished
              ? <Button size="small" variant="secondary" onClick={() => setStatus("draft")} disabled={busy}>Unpublish</Button>
              : <Button size="small" variant="primary" onClick={() => setStatus("published")} disabled={busy}>Publish</Button>}
            <Button size="small" variant="danger" onClick={remove} disabled={busy}>Delete</Button>
          </div>
        ) : null}
      </div>

      {!d ? (
        <div className="px-6 py-16 text-center text-ui-fg-subtle">Loading…</div>
      ) : (
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[320px_1fr]">
          {/* Left: meta + add */}
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <StatusBadge color={isPublished ? "green" : "grey"}>{isPublished ? "Published" : "Draft"}</StatusBadge>
            </div>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label size="small">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label size="small">Theme / collection</Label>
                <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. Cars" />
              </div>
              <div>
                <Button size="small" onClick={saveMeta} disabled={busy}>Save</Button>
                <Text size="xsmall" className="mt-1 text-ui-fg-muted">Price is set in the Case Types screen, not here.</Text>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-ui-border-base p-3">
              <Text size="small" weight="plus">Add a case type / model</Text>
              <Text size="xsmall" className="text-ui-fg-muted">Pick the case type + model, drop an image.</Text>
              <div className="mt-2 grid gap-2">
                <div>
                  <select value={addCt} onChange={(e) => setAddCt(e.target.value)} className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm">
                    <option value="">Case type…</option>
                    {caseTypes.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select>
                  {newCt ? (
                    <div className="mt-1.5 grid gap-1.5 rounded-md border border-ui-border-base p-2">
                      <Input size="small" placeholder="New case type name" value={newCt.name} onChange={(e) => setNewCt({ ...newCt, name: e.target.value })} />
                      <Input size="small" type="number" placeholder="Price (BDT)" value={newCt.price} onChange={(e) => setNewCt({ ...newCt, price: e.target.value })} />
                      <div className="flex gap-2">
                        <Button size="small" variant="secondary" onClick={createCaseType} disabled={busy || !newCt.name || !newCt.price}>Create</Button>
                        <Button size="small" variant="transparent" onClick={() => setNewCt(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="mt-1 text-xs text-ui-fg-interactive hover:underline" onClick={() => setNewCt({ name: "", price: "" })}>+ New case type</button>
                  )}
                </div>
                <div>
                  <select value={addDev} onChange={(e) => setAddDev(e.target.value)} className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm">
                    <option value="">Model…</option>
                    {devices.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
                  </select>
                  {newDev ? (
                    <div className="mt-1.5 grid gap-1.5 rounded-md border border-ui-border-base p-2">
                      <Input size="small" placeholder="New model name" value={newDev.name} onChange={(e) => setNewDev({ ...newDev, name: e.target.value })} />
                      <select value={newDev.family} onChange={(e) => setNewDev({ ...newDev, family: e.target.value })} className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm">
                        <option value="">Type…</option>
                        <option value="iphone">iPhone</option>
                        <option value="samsung">Samsung</option>
                        <option value="airpods">AirPods</option>
                        <option value="watch">Watch</option>
                        <option value="wallet">Wallet</option>
                      </select>
                      <div className="flex gap-2">
                        <Button size="small" variant="secondary" onClick={createDevice} disabled={busy || !newDev.name || !newDev.family}>Create</Button>
                        <Button size="small" variant="transparent" onClick={() => setNewDev(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="mt-1 text-xs text-ui-fg-interactive hover:underline" onClick={() => setNewDev({ name: "", family: "" })}>+ New model</button>
                  )}
                </div>
                <input type="file" accept="image/*" onChange={(e) => setAddFile(e.target.files?.[0] ?? null)} className="text-sm text-ui-fg-subtle" />
                <div>
                  <Button size="small" onClick={addPair} disabled={busy || !addCt || !addDev || !addFile}>Add</Button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: products + variants */}
          <div className="flex flex-col gap-4">
            {d.products.map((p) => (
              <div key={p.id} className="rounded-lg border border-ui-border-base">
                <div className="flex items-center justify-between px-3 py-2">
                  <Text size="small" weight="plus">{FORM_LABEL[p.form] ?? p.form} · {p.variants.length} variants</Text>
                  <Badge size="2xsmall" color={p.status === "published" ? "green" : "grey"}>{p.status}</Badge>
                </div>
                <ul className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
                  {p.variants.map((v) => (
                    <li key={v.id} className="flex items-center gap-2 rounded-md border border-ui-border-base px-2 py-1.5">
                      <span className="size-9 shrink-0 overflow-hidden rounded bg-ui-bg-subtle">
                        {v.image ? <img src={v.image} alt="" className="size-full object-cover" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 text-xs">
                        <span className="block truncate text-ui-fg-base">{v.caseType ?? "—"}</span>
                        <span className="block truncate text-ui-fg-muted">{v.device ?? "—"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Product Manager",
  icon: Swatch,
})

export default ProductManagerPage
