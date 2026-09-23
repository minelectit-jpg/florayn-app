import { defineRouteConfig } from "@medusajs/admin-sdk"
import { SquaresPlus } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"

import {
  Field,
  ImageField,
  ListEditor,
  TextField,
} from "../../components/content-editors"
import { ManagerSelect, api, post, useUnsaved } from "../../components/product-manager/shared"

type Section = {
  id: string
  key: string
  type: string
  title: string | null
  subtitle: string | null
  eyebrow: string | null
  cta_label: string | null
  cta_href: string | null
  config: Record<string, any> | null
  position: number
  is_visible: boolean
}

type PageOption = { slug: string; title: string }

const TYPES: { value: string; label: string; help: string }[] = [
  { value: "hero", label: "Hero slideshow", help: "Big fading photos with a headline and button." },
  { value: "category_pills", label: "Category circles", help: "Round photo shortcuts under the header." },
  { value: "marquee", label: "Announcement strip", help: "A scrolling line of short messages." },
  { value: "tile_grid", label: "Picture tiles", help: "2, 3 or 4 photo tiles linking to categories." },
  { value: "product_carousel", label: "Product row", help: "Newest designs, or one collection's." },
  { value: "collection_grid", label: "Shop by collection", help: "Cards for the collection pages." },
  { value: "banner", label: "Banner", help: "One wide photo with a headline and button." },
  { value: "testimonials", label: "Customer reviews", help: "Quotes with stars." },
]
const typeLabel = (type: string) => TYPES.find((t) => t.value === type)?.label ?? type

/** Which of the shared copy fields a type shows. */
const COPY_FIELDS: Record<string, (keyof Section)[]> = {
  hero: ["cta_label"],
  category_pills: ["title"],
  marquee: [],
  tile_grid: ["eyebrow", "title", "subtitle"],
  product_carousel: ["eyebrow", "title", "subtitle", "cta_label", "cta_href"],
  collection_grid: ["eyebrow", "title", "subtitle"],
  banner: ["eyebrow", "title", "subtitle", "cta_label", "cta_href"],
  testimonials: ["eyebrow", "title", "subtitle"],
}
const COPY_LABELS: Record<string, string> = {
  eyebrow: "Small label above the title",
  title: "Title",
  subtitle: "Subtitle",
  cta_label: "Button label",
  cta_href: "Button link",
}

function summarise(section: Section): string {
  const c = section.config ?? {}
  switch (section.type) {
    case "category_pills": return `${c.items?.length ?? 0} circles`
    case "hero": return `${c.slides?.length ?? 0} slides`
    case "tile_grid": return `${c.tiles?.length ?? 0} tiles, ${c.columns ?? 2} across`
    case "testimonials": return `${c.quotes?.length ?? 0} reviews`
    case "product_carousel": return `${c.limit ?? 5} products${c.collection ? ` from ${c.collection}` : ", newest"}`
    case "collection_grid": return c.slugs?.length ? `${c.slugs.length} chosen collections` : "every visible collection"
    case "marquee": return `${(c.items ?? []).length || 1} messages`
    case "banner": return c.image ? "with picture" : "no picture yet"
    default: return section.type
  }
}

/** The first picture a section holds, for the list thumbnail. */
function thumb(section: Section): string | null {
  const c = section.config ?? {}
  return (
    c.image ??
    c.slides?.find((s: any) => s.image)?.image ??
    c.tiles?.find((t: any) => t.image)?.image ??
    c.items?.find?.((i: any) => i?.image)?.image ??
    null
  )
}

function ConfigEditor({
  section, onChange, pages,
}: {
  section: Section
  onChange: (config: Record<string, any>) => void
  pages: PageOption[]
}) {
  const c = section.config ?? {}
  const set = (key: string, value: unknown) => onChange({ ...c, [key]: value })

  switch (section.type) {
    case "hero":
      return (
        <ListEditor
          items={c.slides ?? []}
          onChange={(v) => set("slides", v)}
          itemLabel="Slide"
          max={8}
          describe={(s) => s.heading || s.href || ""}
          blank={() => ({ eyebrow: "", heading: "", href: "/", cta_label: "", image: null, mobile_image: null })}
          fields={[
            { key: "image", label: "Photo (desktop, wide)", kind: "image", hint: "About 2400 x 1000. The first slide loads first - keep it light." },
            { key: "mobile_image", label: "Photo for phones (optional)", kind: "image", hint: "Portrait or square. Blank uses the desktop photo." },
            { key: "eyebrow", label: "Small label", placeholder: "NEW COLLECTION" },
            { key: "heading", label: "Headline", hint: "Leave blank when the photo already has the words." },
            { key: "href", label: "Link", placeholder: "/collection/bug-life/" },
            { key: "cta_label", label: "Button label", hint: "Blank uses the section's button label." },
          ]}
        />
      )
    case "category_pills":
      return (
        <ListEditor
          items={c.items ?? []}
          onChange={(v) => set("items", v)}
          itemLabel="Circle"
          max={16}
          describe={(i) => i.label || ""}
          blank={() => ({ label: "", href: "/", image: null, note: "" })}
          fields={[
            { key: "image", label: "Photo", kind: "image", hint: "Square; shown as a circle." },
            { key: "label", label: "Label" },
            { key: "href", label: "Link", hint: "Blank shows it greyed out (for Coming Soon)." },
            { key: "note", label: "Note under the label", placeholder: "Coming Soon" },
          ]}
        />
      )
    case "marquee":
      return (
        <ListEditor
          items={(c.items ?? []).map((text: string) => ({ text }))}
          onChange={(v) => set("items", v.map((i) => i.text))}
          itemLabel="Message"
          max={8}
          blank={() => ({ text: "" })}
          fields={[{ key: "text", label: "Message", wide: true, placeholder: "3 To 5 Days Delivery" }]}
        />
      )
    case "tile_grid":
      return (
        <div className="flex flex-col gap-y-4">
          <div className="max-w-xs">
            <Field label="Tiles per row (desktop)">
              <ManagerSelect aria-label="Tiles per row" value={String(c.columns ?? 2)} onValueChange={(v) => set("columns", Number(v))}>
                <option value="2">2 - large landscape tiles</option>
                <option value="3">3 - portrait tiles</option>
                <option value="4">4 - tall portrait tiles</option>
              </ManagerSelect>
            </Field>
          </div>
          <ListEditor
            items={c.tiles ?? []}
            onChange={(v) => set("tiles", v)}
            itemLabel="Tile"
            describe={(t) => t.label || ""}
            blank={() => ({ label: "", subtitle: "", href: "/", image: null })}
            fields={[
              { key: "image", label: "Photo", kind: "image" },
              { key: "label", label: "Label" },
              { key: "subtitle", label: "Second line (optional)" },
              { key: "href", label: "Link" },
            ]}
          />
        </div>
      )
    case "product_carousel":
      return (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="How many products" hint="5 fills a row on desktop; phones swipe.">
            <Input type="number" min={2} max={12} value={c.limit ?? 5} onChange={(e) => set("limit", Number(e.target.value))} />
          </Field>
          <Field label="Which products">
            <ManagerSelect aria-label="Product source" value={c.collection ?? ""} onValueChange={(v) => set("collection", v || null)}>
              <option value="">Newest designs across the store</option>
              {pages.map((p) => <option key={p.slug} value={p.slug}>Newest from {p.title}</option>)}
            </ManagerSelect>
          </Field>
        </div>
      )
    case "collection_grid": {
      const chosen: string[] = c.slugs ?? []
      return (
        <div className="flex flex-col gap-y-3">
          <Text size="small" className="text-ui-fg-subtle">
            Tick collections to choose which show and in what order. None ticked shows every visible collection page, in the Collection pages order.
          </Text>
          <div className="flex flex-wrap gap-2">
            {pages.map((p) => {
              const on = chosen.includes(p.slug)
              return (
                <Button
                  key={p.slug}
                  size="small"
                  variant={on ? "primary" : "secondary"}
                  onClick={() => set("slugs", on ? chosen.filter((s) => s !== p.slug) : [...chosen, p.slug])}
                >
                  {on ? `${chosen.indexOf(p.slug) + 1}. ` : "+ "}{p.title}
                </Button>
              )
            })}
          </div>
          <div className="max-w-xs">
            <Field label="Most to show">
              <Input type="number" min={1} max={24} value={c.limit ?? 12} onChange={(e) => set("limit", Number(e.target.value))} />
            </Field>
          </div>
        </div>
      )
    }
    case "banner":
      return (
        <div className="grid gap-4 md:grid-cols-2">
          <ImageField label="Photo (desktop, wide)" value={c.image} onChange={(v) => set("image", v)} hint="About 2400 x 1000." />
          <ImageField label="Photo for phones (optional)" value={c.mobile_image} onChange={(v) => set("mobile_image", v)} hint="Portrait works best." />
        </div>
      )
    case "testimonials":
      return (
        <ListEditor
          items={c.quotes ?? []}
          onChange={(v) => set("quotes", v)}
          itemLabel="Review"
          describe={(q) => q.name || ""}
          blank={() => ({ name: "", badge: "Verified Buyer", body: "", rating: "5" })}
          fields={[
            { key: "name", label: "Name" },
            { key: "badge", label: "Badge", placeholder: "Verified Buyer" },
            { key: "rating", label: "Stars", kind: "select", options: ["5", "4", "3", "2", "1"].map((v) => ({ value: v, label: `${v} stars` })) },
            { key: "body", label: "Review", kind: "textarea" },
          ]}
        />
      )
    default:
      return <Text size="small">This section type has no settings.</Text>
  }
}

const HomeSectionsPage = () => {
  const [sections, setSections] = useState<Section[]>([])
  const [pages, setPages] = useState<PageOption[]>([])
  const [storefront, setStorefront] = useState("")
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Section | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newType, setNewType] = useState("banner")
  const lock = useRef(false)
  useUnsaved(dirty)

  function load() {
    setLoading(true)
    api("/admin/content")
      .then((d) => setSections(d.sections ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // Collection pages feed the "Shop by collection" and product-row pickers.
    api("/admin/content/collection-pages")
      .then((d) => {
        setStorefront(d.storefrontUrl ?? "")
        setPages((d.pages ?? []).map((p: any) => ({
          slug: p.collection_slug,
          title: p.title || d.targets?.find((t: any) => t.handle === p.collection_slug)?.title || p.collection_slug,
        })))
      })
      .catch(() => undefined)
  }, [])

  const ordered = [...sections].sort((a, b) => a.position - b.position)

  async function run(fn: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try { await fn() } catch (e: any) { toast.error(e.message) } finally { lock.current = false; setBusy(false) }
  }

  const leaveEditor = () => !dirty || window.confirm("Discard unsaved changes to this section?")

  const reorder = (index: number, delta: number) => run(async () => {
    const order = ordered.map((s) => s.id)
    const [moved] = order.splice(index, 1)
    order.splice(index + delta, 0, moved)
    const d = await post("/admin/content/home-sections", { order })
    setSections(d.sections)
  })

  const toggle = (section: Section, visible: boolean) => run(async () => {
    const d = await post(`/admin/content/home-sections/${section.id}`, { is_visible: visible })
    setSections(d.sections)
    toast.success(visible ? "Now showing on the home page" : "Hidden from the home page")
  })

  const add = () => run(async () => {
    if (!leaveEditor()) return
    const d = await post("/admin/content/home-sections", { action: "create", type: newType, after_id: editing?.id })
    setSections(d.sections)
    const created = d.sections.find((s: Section) => s.id === d.created_id)
    setEditing(created ?? null)
    setDirty(false)
    toast.success("Section added (hidden). Fill it in, save, then switch it on.")
  })

  const duplicate = (section: Section) => run(async () => {
    if (!leaveEditor()) return
    const d = await post("/admin/content/home-sections", { action: "duplicate", id: section.id })
    setSections(d.sections)
    setEditing(d.sections.find((s: Section) => s.id === d.created_id) ?? null)
    setDirty(false)
    toast.success("Copied below the original (hidden until you switch it on).")
  })

  const remove = (section: Section) => run(async () => {
    if (!window.confirm(`Delete "${section.title || typeLabel(section.type)}"? This cannot be undone - hiding it keeps it for later.`)) return
    const d = await api(`/admin/content/home-sections/${section.id}`, { method: "DELETE" })
    setSections(d.sections)
    if (editing?.id === section.id) { setEditing(null); setDirty(false) }
    toast.success("Section deleted")
  })

  const save = () => run(async () => {
    if (!editing) return
    const copy = Object.fromEntries(
      (["title", "subtitle", "eyebrow", "cta_label", "cta_href"] as const).map((k) => [k, editing[k] ?? ""])
    )
    const d = await post(`/admin/content/home-sections/${editing.id}`, { ...copy, config: editing.config ?? {} })
    setSections(d.sections)
    setEditing(d.sections.find((s: Section) => s.id === editing.id) ?? null)
    setDirty(false)
    toast.success("Saved - the home page updates within a minute.")
  })

  const patch = (next: Partial<Section>) => {
    setEditing((current) => (current ? { ...current, ...next } : current))
    setDirty(true)
  }

  if (loading) {
    return <Container><Text>Loading home page...</Text></Container>
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
          <div className="max-w-xl">
            <Heading level="h1">Home page</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              The bands of the home page, top to bottom. Edit pictures and words, reorder, hide, copy or add sections. New and copied sections start hidden.
            </Text>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <ManagerSelect aria-label="New section type" value={newType} onValueChange={setNewType}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </ManagerSelect>
            </div>
            <Button size="small" onClick={add} disabled={busy}>+ Add section</Button>
            {storefront ? (
              <a href={`${storefront}/`} target="_blank" rel="noreferrer noopener">
                <Button size="small" variant="secondary">View site</Button>
              </a>
            ) : null}
          </div>
        </div>
        <Text size="xsmall" className="text-ui-fg-subtle px-6 pb-4">
          {TYPES.find((t) => t.value === newType)?.help}
          {editing ? " It is added below the section you are editing." : " It is added at the bottom."}
        </Text>
      </Container>

      {ordered.map((section, index) => {
        const open = editing?.id === section.id
        const picture = thumb(section)
        return (
          <Container key={section.id} className={`divide-y p-0 ${open ? "ring-ui-border-interactive ring-2" : ""}`}>
            <div className="flex flex-wrap items-center gap-3 px-6 py-3">
              <div className="flex gap-x-1">
                <Button size="small" variant="transparent" disabled={busy || index === 0} onClick={() => reorder(index, -1)} aria-label="Move up">↑</Button>
                <Button size="small" variant="transparent" disabled={busy || index === ordered.length - 1} onClick={() => reorder(index, 1)} aria-label="Move down">↓</Button>
              </div>
              <div className="bg-ui-bg-subtle border-ui-border-base flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded border">
                {picture ? <img src={picture} alt="" className="h-full w-full object-cover" /> : <Text size="xsmall" className="text-ui-fg-muted">{index + 1}</Text>}
              </div>
              <div className="min-w-48 flex-1">
                <Text size="small" weight="plus">{section.title || typeLabel(section.type)}</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">{typeLabel(section.type)} - {summarise(section)}</Text>
              </div>
              {!section.is_visible ? <Badge size="2xsmall" color="orange">Hidden</Badge> : null}
              <div className="flex items-center gap-x-2">
                <Label size="small">Shown</Label>
                <Switch checked={section.is_visible} disabled={busy} onCheckedChange={(v) => toggle(section, v)} />
                <Button size="small" variant={open ? "primary" : "secondary"} disabled={busy} onClick={() => {
                  if (open) { if (leaveEditor()) { setEditing(null); setDirty(false) } return }
                  if (leaveEditor()) { setEditing(section); setDirty(false) }
                }}>
                  {open ? "Close" : "Edit"}
                </Button>
                <Button size="small" variant="transparent" disabled={busy} onClick={() => duplicate(section)}>Duplicate</Button>
                <Button size="small" variant="transparent" disabled={busy} onClick={() => remove(section)}>Delete</Button>
              </div>
            </div>

            {open && editing ? (
              <>
                {(COPY_FIELDS[editing.type] ?? []).length ? (
                  <div className="grid gap-3 px-6 py-4 md:grid-cols-2">
                    {(COPY_FIELDS[editing.type] ?? []).map((key) => (
                      <TextField
                        key={key}
                        label={COPY_LABELS[key]}
                        value={editing[key] as string | null}
                        onChange={(v) => patch({ [key]: v } as Partial<Section>)}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="px-6 py-4">
                  <ConfigEditor section={editing} pages={pages} onChange={(config) => patch({ config })} />
                </div>
                <div className="flex items-center justify-end gap-x-2 px-6 py-3">
                  {dirty ? <Text size="xsmall" className="text-ui-fg-subtle mr-auto">Unsaved changes</Text> : null}
                  <Button size="small" variant="secondary" disabled={busy} onClick={() => { if (leaveEditor()) { setEditing(null); setDirty(false) } }}>Cancel</Button>
                  <Button size="small" isLoading={busy} disabled={!dirty} onClick={save}>Save section</Button>
                </div>
              </>
            ) : null}
          </Container>
        )
      })}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Home page",
  icon: SquaresPlus,
})

export default HomeSectionsPage
