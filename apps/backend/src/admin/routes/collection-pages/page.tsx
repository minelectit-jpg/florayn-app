import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo } from "@medusajs/icons"
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
import { useEffect, useRef, useState, type CSSProperties } from "react"

import {
  ColorField,
  Field,
  ImageField,
  ListEditor,
  TextField,
} from "../../components/content-editors"
import { ManagerSelect, api, post, useUnsaved } from "../../components/product-manager/shared"

type Theme = {
  bg: string; text: string; muted: string; line: string
  accent: string; accent_text: string; hero_bg: string; hero_text: string
  card_bg: string; card_border: string; card_text: string; card_muted: string
  card_radius: number; heading_size: "md" | "lg" | "xl"; decor: string[]
}

type Block = {
  type: "banner" | "text"
  eyebrow?: string | null; heading: string | null; copy: string | null
  image?: string | null; mobile_image?: string | null
  cta_label?: string | null; cta_href?: string | null
}

type Page = {
  id: string
  collection_slug: string
  title: string | null
  template: string
  theme: Theme
  hero_image_url: string | null
  hero_mobile_image_url: string | null
  hero_eyebrow: string | null
  hero_heading: string | null
  hero_copy: string | null
  card_image_url: string | null
  cta_label: string | null
  cta_href: string | null
  intro_heading: string | null
  intro_copy: string | null
  design_slugs: string[]
  blocks: Block[]
  is_visible: boolean
  /** In the Collections row of the phone menu; absent (an older backend) means shown. */
  show_in_menu?: boolean
  position: number
}

type Preset = { id: string; name: string; description: string; template: string; theme: Theme }
type Target = { handle: string; title: string; kind: "collection" | "category" }
type Design = { slug: string; name: string }

const LAYOUTS: { value: string; label: string; help: string }[] = [
  { value: "overlay", label: "Photo with text over it", help: "Full-width photo, headline bottom-left." },
  { value: "centered", label: "Photo with centred headline", help: "Full-width photo, a big centred headline." },
  { value: "split", label: "Colour panel + photo", help: "Headline on a coloured panel beside the photo. Takes decor." },
  { value: "image", label: "Photo only", help: "For campaign art that already has the title in it." },
]

const TABS = [
  { id: "look", label: "Template & colours" },
  { id: "hero", label: "Hero & card" },
  { id: "products", label: "Products" },
  { id: "blocks", label: "Below the grid" },
] as const
type Tab = (typeof TABS)[number]["id"]

/** A miniature of the page in its colours, so a theme can be judged at a glance. */
function Preview({ page }: { page: Page }) {
  const t = page.theme
  const card: CSSProperties = {
    background: t.card_bg,
    border: `1px solid ${t.card_border}`,
    borderRadius: t.card_radius,
  }
  const split = page.template === "split" || !page.hero_image_url
  return (
    <div className="overflow-hidden rounded-lg border border-ui-border-base" style={{ background: t.bg, color: t.text }}>
      <div className="p-3">
        <div className="grid overflow-hidden rounded-md" style={{ background: t.hero_bg, color: t.hero_text, gridTemplateColumns: split ? "1fr 1fr" : "1fr", minHeight: 96 }}>
          <div className="relative flex flex-col justify-end gap-1 p-3" style={!split && page.hero_image_url ? { backgroundImage: `linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0)), url(${page.hero_image_url})`, backgroundSize: "cover", backgroundPosition: "center", color: "#fff", minHeight: 96, textAlign: page.template === "centered" ? "center" : "left", alignItems: page.template === "centered" ? "center" : "flex-start", justifyContent: page.template === "centered" ? "center" : "flex-end" } : undefined}>
            {page.template !== "image" ? (
              <>
                <span style={{ fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase", opacity: .85 }}>{page.hero_eyebrow}</span>
                <span style={{ fontSize: t.heading_size === "xl" ? 20 : t.heading_size === "lg" ? 17 : 14, fontWeight: 600, lineHeight: 1.05 }}>{page.hero_heading || page.collection_slug}</span>
              </>
            ) : null}
            {page.cta_label ? (
              <span style={{ alignSelf: page.template === "centered" ? "center" : "flex-start", marginTop: 4, padding: "3px 10px", borderRadius: 99, background: t.accent, color: t.accent_text, fontSize: 10, fontWeight: 600 }}>{page.cta_label}</span>
            ) : null}
          </div>
          {split ? (
            <div style={{ backgroundImage: page.hero_image_url ? `url(${page.hero_image_url})` : undefined, backgroundSize: "cover", backgroundPosition: "center", background: page.hero_image_url ? undefined : "#fff" }} />
          ) : null}
        </div>
        <p className="mt-3 text-center" style={{ fontSize: 13, fontWeight: 600 }}>{page.intro_heading}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} style={card} className="overflow-hidden">
              <div style={{ aspectRatio: "1", background: t.card_bg }} className="flex items-center justify-center">
                <div style={{ width: "46%", height: "70%", borderRadius: 6, background: `linear-gradient(135deg, ${t.accent}, ${t.hero_bg})`, opacity: .8 }} />
              </div>
              <div className="px-1.5 pb-2 text-center">
                <p style={{ fontSize: 10, fontWeight: 600, color: t.card_text }}>Design {i + 1}</p>
                <p style={{ fontSize: 8, color: t.card_muted }}>iPhone 17 Pro Max Case</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: t.card_text }}>৳ 1,400</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center" style={{ fontSize: 9, color: t.muted }}>Filters and counts use the muted colour</p>
      </div>
    </div>
  )
}

function Swatches({ theme }: { theme: Theme }) {
  return (
    <span className="flex overflow-hidden rounded border border-ui-border-base">
      {[theme.bg, theme.hero_bg, theme.accent, theme.card_bg].map((c, i) => (
        <span key={i} className="h-5 w-4" style={{ background: c }} />
      ))}
    </span>
  )
}

const CollectionPagesPage = () => {
  const [pages, setPages] = useState<Page[]>([])
  const [designs, setDesigns] = useState<Record<string, Design[]>>({})
  const [targets, setTargets] = useState<Target[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [storefront, setStorefront] = useState("")
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Page | null>(null)
  const [tab, setTab] = useState<Tab>("look")
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState<{ mode: "new" | "copy"; from?: Page; slug: string; preset: string } | null>(null)
  const lock = useRef(false)
  useUnsaved(dirty)

  function apply(d: any) {
    if (d.pages) setPages(d.pages)
    if (d.designsByCollection) setDesigns(d.designsByCollection)
    if (d.targets) setTargets(d.targets)
    if (d.presets) setPresets(d.presets)
    if (typeof d.storefrontUrl === "string") setStorefront(d.storefrontUrl)
  }

  useEffect(() => {
    api("/admin/content/collection-pages")
      .then(apply)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [])

  const ordered = [...pages].sort((a, b) => a.position - b.position)
  const titleOf = (p: Page) => p.title || targets.find((t) => t.handle === p.collection_slug)?.title || p.collection_slug
  const free = targets.filter((t) => !pages.some((p) => p.collection_slug === t.handle))
  const viewUrl = (slug: string) => `${storefront}/collection/${slug}/`

  async function run(fn: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try { await fn() } catch (e: any) { toast.error(e.message) } finally { lock.current = false; setBusy(false) }
  }
  const leaveEditor = () => !dirty || window.confirm("Discard unsaved changes to this page?")
  const open = (page: Page | null) => {
    if (!leaveEditor()) return
    setEditing(page)
    setDirty(false)
    setTab("look")
  }
  const patch = (next: Partial<Page>) => {
    setEditing((current) => (current ? { ...current, ...next } : current))
    setDirty(true)
  }
  const setTheme = (next: Partial<Theme>) => editing && patch({ theme: { ...editing.theme, ...next } })

  const reorder = (index: number, delta: number) => run(async () => {
    const order = ordered.map((p) => p.id)
    const [moved] = order.splice(index, 1)
    order.splice(index + delta, 0, moved)
    apply(await post("/admin/content/collection-pages", { order }))
  })

  const toggle = (page: Page, visible: boolean) => run(async () => {
    apply(await post(`/admin/content/collection-pages/${page.id}`, { is_visible: visible }))
    toast.success(visible ? `${titleOf(page)} is live` : `${titleOf(page)} is hidden`)
  })

  const toggleMenu = (page: Page, inMenu: boolean) => run(async () => {
    const d = await post(`/admin/content/collection-pages/${page.id}`, { show_in_menu: inMenu })
    apply(d)
    // A backend without the column answers without it: say so.
    if ((d.pages ?? []).some((p: Page) => p.id === page.id && p.show_in_menu === undefined)) {
      throw new Error("The server did not save Show in menu. Update the backend, then try again.")
    }
    toast.success(inMenu ? `${titleOf(page)} added to the menu` : `${titleOf(page)} removed from the menu`)
  })

  const create = () => run(async () => {
    if (!creating?.slug) throw new Error("Choose which collection the page is for.")
    const body = creating.mode === "copy"
      ? { action: "duplicate", id: creating.from!.id, collection_slug: creating.slug }
      : { action: "create", collection_slug: creating.slug, preset: creating.preset }
    const d = await post("/admin/content/collection-pages", body)
    apply(d)
    setCreating(null)
    const made = (d.pages ?? []).find((p: Page) => p.id === d.created_id)
    if (made) { setEditing(made); setDirty(false); setTab("hero") }
    toast.success("Page created as a draft. Check the hero and pictures, save, then switch it on.")
  })

  const remove = (page: Page) => run(async () => {
    if (!window.confirm(`Delete the ${titleOf(page)} page? /collection/${page.collection_slug}/ goes back to a plain product grid. Hiding it keeps it instead.`)) return
    apply(await api(`/admin/content/collection-pages/${page.id}`, { method: "DELETE" }))
    if (editing?.id === page.id) { setEditing(null); setDirty(false) }
    toast.success("Page deleted")
  })

  const save = () => run(async () => {
    if (!editing) return
    const p = editing
    const d = await post(`/admin/content/collection-pages/${p.id}`, {
      title: p.title ?? "", template: p.template, theme: p.theme,
      hero_image_url: p.hero_image_url ?? "", hero_mobile_image_url: p.hero_mobile_image_url ?? "",
      hero_eyebrow: p.hero_eyebrow ?? "", hero_heading: p.hero_heading ?? "", hero_copy: p.hero_copy ?? "",
      card_image_url: p.card_image_url ?? "", cta_label: p.cta_label ?? "", cta_href: p.cta_href ?? "",
      intro_heading: p.intro_heading ?? "", intro_copy: p.intro_copy ?? "",
      design_slugs: p.design_slugs ?? [], blocks: p.blocks ?? [],
    })
    apply(d)
    setEditing((d.pages ?? []).find((x: Page) => x.id === p.id) ?? null)
    setDirty(false)
    toast.success(`${titleOf(p)} saved - live within a minute.`)
  })

  if (loading) return <Container><Text>Loading collection pages...</Text></Container>

  function DesignOrder({ page }: { page: Page }) {
    const all = designs[page.collection_slug] ?? []
    const chosen = (page.design_slugs ?? []).filter((s) => all.some((d) => d.slug === s))
    const rest = all.filter((d) => !chosen.includes(d.slug))
    const move = (i: number, delta: number) => {
      const next = [...chosen]
      const [m] = next.splice(i, 1)
      next.splice(i + delta, 0, m)
      patch({ design_slugs: next })
    }
    return (
      <div className="flex flex-col gap-y-3">
        <Text size="small" className="text-ui-fg-subtle">
          Empty shows every design in the collection. Add designs to choose which appear and in what order (shoppers can still sort).
        </Text>
        {chosen.map((slug, i) => (
          <div key={slug} className="flex items-center gap-x-2">
            <Button size="small" variant="transparent" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</Button>
            <Button size="small" variant="transparent" disabled={i === chosen.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</Button>
            <Text size="small" className="flex-1">{all.find((d) => d.slug === slug)?.name ?? slug}</Text>
            <Button size="small" variant="transparent" onClick={() => patch({ design_slugs: chosen.filter((s) => s !== slug) })}>Remove</Button>
          </div>
        ))}
        {!chosen.length ? <Text size="small">Showing all {all.length} designs.</Text> : null}
        {rest.length ? (
          <div className="flex flex-wrap gap-2">
            {rest.map((d) => (
              <Button key={d.slug} size="small" variant="secondary" onClick={() => patch({ design_slugs: [...chosen, d.slug] })}>+ {d.name}</Button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
          <div className="max-w-xl">
            <Heading level="h1">Collection pages</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Each collection&rsquo;s landing page at /collection/&lt;slug&gt;/. Start a new one from a template or duplicate an existing page onto another collection, then change its words, pictures and colours. The product cards stay the same design and take on the page&rsquo;s colours.
            </Text>
            <Text id="show-in-menu-help" size="small" className="mt-2 text-ui-fg-subtle">
              <span className="font-medium text-ui-fg-base">Show in menu:</span> Adds the page to the Collections row in the phone menu, in this list&apos;s order.
            </Text>
          </div>
          <Button size="small" disabled={busy || !free.length} onClick={() => setCreating({ mode: "new", slug: free[0]?.handle ?? "", preset: presets[0]?.id ?? "classic" })}>
            + New page
          </Button>
        </div>

        {creating ? (
          <div className="border-t border-ui-border-base px-6 py-4">
            <Text size="small" weight="plus">
              {creating.mode === "copy" ? `Duplicate ${titleOf(creating.from!)} onto another collection` : "New page from a template"}
            </Text>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Field label="For which collection" hint="Only collections and categories without a page are listed.">
                <ManagerSelect aria-label="Target collection" value={creating.slug} onValueChange={(slug) => setCreating({ ...creating, slug })}>
                  {free.map((t) => <option key={t.handle} value={t.handle}>{t.title} ({t.kind}, /{t.handle}/)</option>)}
                </ManagerSelect>
              </Field>
              {creating.mode === "new" ? (
                <Field label="Template">
                  <ManagerSelect aria-label="Template" value={creating.preset} onValueChange={(preset) => setCreating({ ...creating, preset })}>
                    {presets.map((p) => <option key={p.id} value={p.id}>{p.name} - {p.description}</option>)}
                  </ManagerSelect>
                </Field>
              ) : (
                <Text size="small" className="text-ui-fg-subtle self-end">
                  Copies the template, colours, hero pictures, words and banners. The collection&rsquo;s name and links are swapped for the new one&rsquo;s; the design list starts empty (all designs).
                </Text>
              )}
            </div>
            <div className="mt-4 flex gap-x-2">
              <Button size="small" isLoading={busy} onClick={create}>{creating.mode === "copy" ? "Duplicate page" : "Create page"}</Button>
              <Button size="small" variant="secondary" disabled={busy} onClick={() => setCreating(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </Container>

      {ordered.map((page, index) => {
        const isOpen = editing?.id === page.id
        const e = isOpen ? editing! : null
        const picture = page.card_image_url || page.hero_image_url
        return (
          <Container key={page.id} className={`divide-y p-0 ${isOpen ? "ring-ui-border-interactive ring-2" : ""}`}>
            <div className="flex flex-wrap items-center gap-3 px-6 py-3">
              <div className="flex gap-x-1">
                <Button size="small" variant="transparent" disabled={busy || index === 0} onClick={() => reorder(index, -1)} aria-label="Move up">↑</Button>
                <Button size="small" variant="transparent" disabled={busy || index === ordered.length - 1} onClick={() => reorder(index, 1)} aria-label="Move down">↓</Button>
              </div>
              <div className="bg-ui-bg-subtle border-ui-border-base flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded border" style={{ background: page.theme.hero_bg }}>
                {picture ? <img src={picture} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-48 flex-1">
                <Text size="small" weight="plus">{titleOf(page)}</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">/collection/{page.collection_slug}/ - {LAYOUTS.find((l) => l.value === page.template)?.label}</Text>
              </div>
              <Swatches theme={page.theme} />
              {!page.is_visible ? <Badge size="2xsmall" color="orange">Draft</Badge> : null}
              <div className="flex items-center gap-x-2">
                <Label size="small">Shown</Label>
                <Switch checked={page.is_visible} disabled={busy} onCheckedChange={(v) => toggle(page, v)} />
                <Label size="small" htmlFor={`menu-${page.id}`} className="ml-2">Show in menu</Label>
                <Switch id={`menu-${page.id}`} aria-describedby="show-in-menu-help" checked={page.show_in_menu !== false} disabled={busy} onCheckedChange={(v) => toggleMenu(page, v)} />
                <Button size="small" variant={isOpen ? "primary" : "secondary"} disabled={busy} onClick={() => open(isOpen ? null : page)}>
                  {isOpen ? "Close" : "Edit"}
                </Button>
                <Button size="small" variant="transparent" disabled={busy || !free.length} onClick={() => setCreating({ mode: "copy", from: page, slug: free[0]?.handle ?? "", preset: "" })}>Duplicate</Button>
                {storefront ? (
                  <a href={viewUrl(page.collection_slug)} target="_blank" rel="noreferrer noopener">
                    <Button size="small" variant="transparent">View</Button>
                  </a>
                ) : null}
                <Button size="small" variant="transparent" disabled={busy} onClick={() => remove(page)}>Delete</Button>
              </div>
            </div>

            {e ? (
              <>
                <div className="flex flex-wrap gap-2 px-6 py-3">
                  {TABS.map((t) => (
                    <Button key={t.id} size="small" variant={tab === t.id ? "primary" : "secondary"} onClick={() => setTab(t.id)}>{t.label}</Button>
                  ))}
                </div>

                <div className="grid gap-6 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="flex min-w-0 flex-col gap-y-5">
                    {tab === "look" ? (
                      <>
                        <Field label="Start from a template" hint="Applies that template's layout and colours. Words and pictures stay.">
                          <div className="flex flex-wrap gap-2">
                            {presets.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                title={p.description}
                                onClick={() => patch({ template: p.template, theme: { ...p.theme, decor: e.theme.decor } })}
                                className="border-ui-border-base hover:border-ui-border-interactive flex items-center gap-x-2 rounded-md border px-2 py-1.5"
                              >
                                <Swatches theme={p.theme} />
                                <Text size="small">{p.name}</Text>
                              </button>
                            ))}
                          </div>
                        </Field>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Hero layout" hint={LAYOUTS.find((l) => l.value === e.template)?.help}>
                            <ManagerSelect aria-label="Hero layout" value={e.template} onValueChange={(template) => patch({ template })}>
                              {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                            </ManagerSelect>
                          </Field>
                          <Field label="Headline size">
                            <ManagerSelect aria-label="Headline size" value={e.theme.heading_size} onValueChange={(v) => setTheme({ heading_size: v as Theme["heading_size"] })}>
                              <option value="md">Regular</option>
                              <option value="lg">Large</option>
                              <option value="xl">Extra large</option>
                            </ManagerSelect>
                          </Field>
                        </div>
                        <div>
                          <Text size="small" weight="plus">Page</Text>
                          <div className="mt-2 grid gap-3 md:grid-cols-2">
                            <ColorField label="Background" value={e.theme.bg} onChange={(bg) => setTheme({ bg })} />
                            <ColorField label="Text" value={e.theme.text} onChange={(text) => setTheme({ text })} />
                            <ColorField label="Muted text" value={e.theme.muted} onChange={(muted) => setTheme({ muted })} />
                            <ColorField label="Lines" value={e.theme.line} onChange={(line) => setTheme({ line })} />
                            <ColorField label="Buttons" value={e.theme.accent} onChange={(accent) => setTheme({ accent })} />
                            <ColorField label="Button text" value={e.theme.accent_text} onChange={(accent_text) => setTheme({ accent_text })} />
                            <ColorField label="Hero panel" value={e.theme.hero_bg} onChange={(hero_bg) => setTheme({ hero_bg })} />
                            <ColorField label="Hero panel text" value={e.theme.hero_text} onChange={(hero_text) => setTheme({ hero_text })} />
                          </div>
                        </div>
                        <div>
                          <Text size="small" weight="plus">Product cards on this page</Text>
                          <div className="mt-2 grid gap-3 md:grid-cols-2">
                            <ColorField label="Card background" value={e.theme.card_bg} onChange={(card_bg) => setTheme({ card_bg })} />
                            <ColorField label="Card border" value={e.theme.card_border} onChange={(card_border) => setTheme({ card_border })} allowNone />
                            <ColorField label="Card title and price" value={e.theme.card_text} onChange={(card_text) => setTheme({ card_text })} />
                            <ColorField label="Card model line" value={e.theme.card_muted} onChange={(card_muted) => setTheme({ card_muted })} />
                            <Field label="Card corner roundness (px)">
                              <Input type="number" min={0} max={32} value={e.theme.card_radius} onChange={(ev) => setTheme({ card_radius: Number(ev.target.value) })} />
                            </Field>
                          </div>
                        </div>
                        <div>
                          <Text size="small" weight="plus">Decor on the colour panel</Text>
                          <Text size="xsmall" className="text-ui-fg-subtle">Small floating pictures (like Bug Life&rsquo;s bugs). Shown with the &ldquo;Colour panel + photo&rdquo; layout.</Text>
                          <div className="mt-2">
                            <ListEditor
                              items={e.theme.decor.map((url) => ({ url }))}
                              onChange={(items) => setTheme({ decor: items.map((i) => i.url).filter(Boolean) })}
                              itemLabel="Decor"
                              max={7}
                              blank={() => ({ url: "" })}
                              fields={[{ key: "url", label: "Picture (SVG or PNG)", kind: "image", wide: true }]}
                            />
                          </div>
                        </div>
                      </>
                    ) : null}

                    {tab === "hero" ? (
                      <>
                        <div className="grid gap-4 md:grid-cols-2">
                          <ImageField label="Hero photo" value={e.hero_image_url} onChange={(v) => patch({ hero_image_url: v })} hint="Blank uses one of the collection's own designs." />
                          <ImageField label="Hero photo for phones (optional)" value={e.hero_mobile_image_url} onChange={(v) => patch({ hero_mobile_image_url: v })} hint="Portrait works best." />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <TextField label="Small label above the headline" value={e.hero_eyebrow} onChange={(v) => patch({ hero_eyebrow: v })} />
                          <TextField label="Headline" value={e.hero_heading} onChange={(v) => patch({ hero_heading: v })} />
                          <TextField label="Button label" value={e.cta_label} onChange={(v) => patch({ cta_label: v })} />
                          <TextField label="Button link" value={e.cta_href} onChange={(v) => patch({ cta_href: v })} hint="This page's own link scrolls to the products." />
                        </div>
                        <TextField label="A line under the headline (optional)" multiline value={e.hero_copy} onChange={(v) => patch({ hero_copy: v })} />
                        <div className="grid gap-4 md:grid-cols-2">
                          <TextField label="Heading above the products" value={e.intro_heading} onChange={(v) => patch({ intro_heading: v })} />
                          <TextField label="Display name" value={e.title} onChange={(v) => patch({ title: v })} hint={`On cards and the collections page. Blank: ${targets.find((t) => t.handle === e.collection_slug)?.title ?? e.collection_slug}`} />
                        </div>
                        <TextField label="Copy above the products" multiline value={e.intro_copy} onChange={(v) => patch({ intro_copy: v })} />
                        <ImageField label="Card picture (home page and /collections/)" value={e.card_image_url} onChange={(v) => patch({ card_image_url: v })} hint="Portrait (3:4) or square. Blank uses the hero photo." square />
                      </>
                    ) : null}

                    {tab === "products" ? <DesignOrder page={e} /> : null}

                    {tab === "blocks" ? (
                      <>
                        <Text size="small" className="text-ui-fg-subtle">
                          Banners and text shown under the product grid, e.g. an AirPods banner linking to /collection/{e.collection_slug}/?form=airpods#shop.
                        </Text>
                        <ListEditor<Block>
                          items={e.blocks}
                          onChange={(blocks) => patch({ blocks })}
                          itemLabel="Block"
                          max={12}
                          describe={(b) => `${b.type === "banner" ? "Banner" : "Text"}${b.heading ? `: ${b.heading}` : ""}`}
                          blank={() => ({ type: "banner", eyebrow: "", heading: "", copy: "", image: null, mobile_image: null, cta_label: "", cta_href: "" })}
                          fields={[
                            { key: "type", label: "Kind", kind: "select", options: [{ value: "banner", label: "Banner with photo" }, { value: "text", label: "Text only" }] },
                            { key: "eyebrow", label: "Small label (banner)" },
                            { key: "heading", label: "Heading" },
                            { key: "copy", label: "Text", kind: "textarea" },
                            { key: "image", label: "Photo (banner)", kind: "image" },
                            { key: "mobile_image", label: "Photo for phones (banner, optional)", kind: "image" },
                            { key: "cta_label", label: "Button label (banner)" },
                            { key: "cta_href", label: "Button link (banner)" },
                          ]}
                        />
                      </>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-y-2 lg:sticky lg:top-4 lg:self-start">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Preview</Text>
                    <Preview page={e} />
                    {storefront ? (
                      <a href={viewUrl(e.collection_slug)} target="_blank" rel="noreferrer noopener">
                        <Button size="small" variant="secondary" className="w-full">Open the live page</Button>
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-x-2 px-6 py-3">
                  {dirty ? <Text size="xsmall" className="text-ui-fg-subtle mr-auto">Unsaved changes</Text> : null}
                  <Button size="small" variant="secondary" disabled={busy} onClick={() => open(null)}>Cancel</Button>
                  <Button size="small" isLoading={busy} disabled={!dirty} onClick={save}>Save page</Button>
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
  label: "Collection pages",
  icon: Photo,
})

export default CollectionPagesPage
