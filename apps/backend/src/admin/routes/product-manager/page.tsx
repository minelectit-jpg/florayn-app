import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Swatch } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  StatusBadge,
  Text,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

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

const STATUS_COLOR: Record<Status, "green" | "grey" | "orange"> = {
  published: "green",
  draft: "grey",
  mixed: "orange",
}
const FORM_LABEL: Record<string, string> = {
  phone: "Phone",
  airpods: "AirPods",
  watch: "Watch",
  wallet: "Wallet",
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: "include", headers: { "content-type": "application/json" }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || "Request failed.")
  return data
}

const ProductManagerPage = () => {
  const [designs, setDesigns] = useState<DesignSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [openSlug, setOpenSlug] = useState<string | null>(null)

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
                  onClick={() => setOpenSlug(d.slug)}
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
                      {d.forms.map((f) => (
                        <Badge key={f} size="2xsmall">{FORM_LABEL[f] ?? f}</Badge>
                      ))}
                      <span className="text-xs text-ui-fg-muted">· {d.variantCount} variant{d.variantCount === 1 ? "" : "s"}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openSlug ? (
        <DesignDrawer slug={openSlug} onClose={() => setOpenSlug(null)} onChanged={load} />
      ) : null}
    </Container>
  )
}

function DesignDrawer({ slug, onClose, onChanged }: { slug: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<DesignDetail | null>(null)
  const [name, setName] = useState("")
  const [theme, setTheme] = useState("")
  const [busy, setBusy] = useState(false)

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
  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const isPublished = d?.products.every((p) => p.status === "published") ?? false

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e: any) {
      toast.error(e?.message || `${label} failed.`)
    } finally {
      setBusy(false)
    }
  }

  const saveMeta = () =>
    run("Save", async () => {
      await api(`/admin/designs/${slug}`, { method: "PATCH", body: JSON.stringify({ name, theme }) })
      toast.success("Saved")
      await loadDetail()
      onChanged()
    })

  const setStatus = (status: "published" | "draft") =>
    run("Status", async () => {
      await api(`/admin/designs/${slug}`, { method: "PATCH", body: JSON.stringify({ status }) })
      toast.success(status === "published" ? "Published" : "Unpublished")
      await loadDetail()
      onChanged()
    })

  const remove = () =>
    run("Delete", async () => {
      if (!window.confirm(`Delete "${d?.name}" and all its products? This cannot be undone.`)) return
      await api(`/admin/designs/${slug}`, { method: "DELETE" })
      toast.success("Deleted")
      onChanged()
      onClose()
    })

  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose() }}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{d?.name ?? "Design"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-5 overflow-y-auto">
          {!d ? (
            <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <StatusBadge color={isPublished ? "green" : "grey"}>{isPublished ? "Published" : "Draft"}</StatusBadge>
                <Text size="xsmall" className="text-ui-fg-muted">/{slug}</Text>
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

              {d.products.map((p) => (
                <div key={p.id} className="rounded-lg border border-ui-border-base">
                  <div className="flex items-center justify-between px-3 py-2">
                    <Text size="small" weight="plus">{FORM_LABEL[p.form] ?? p.form} · {p.variants.length} variants</Text>
                    <Badge size="2xsmall" color={p.status === "published" ? "green" : "grey"}>{p.status}</Badge>
                  </div>
                  <ul className="divide-y divide-ui-border-base">
                    {p.variants.map((v) => (
                      <li key={v.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="size-9 shrink-0 overflow-hidden rounded bg-ui-bg-subtle">
                          {v.image ? <img src={v.image} alt="" className="size-full object-cover" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="text-ui-fg-base">{v.caseType ?? "—"}</span>
                          <span className="text-ui-fg-muted"> · {v.device ?? "—"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          {d ? (
            <div className="flex w-full items-center gap-2">
              {isPublished ? (
                <Button size="small" variant="secondary" onClick={() => setStatus("draft")} disabled={busy}>Unpublish</Button>
              ) : (
                <Button size="small" variant="primary" onClick={() => setStatus("published")} disabled={busy}>Publish</Button>
              )}
              <div className="grow" />
              <Button size="small" variant="danger" onClick={remove} disabled={busy}>Delete</Button>
            </div>
          ) : null}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const config = defineRouteConfig({
  label: "Product Manager",
  icon: Swatch,
})

export default ProductManagerPage
