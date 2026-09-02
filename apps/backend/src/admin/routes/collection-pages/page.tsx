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
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type Page = {
  id: string
  collection_slug: string
  hero_image_url: string | null
  hero_eyebrow: string | null
  hero_heading: string | null
  cta_label: string | null
  cta_href: string | null
  intro_heading: string | null
  intro_copy: string | null
  design_slugs: string[] | null
  is_visible: boolean
  position: number
}

type Design = { slug: string; name: string }

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`)
  return body
}

const CollectionPagesPage = () => {
  const [pages, setPages] = useState<Page[]>([])
  const [designs, setDesigns] = useState<Record<string, Design[]>>({})
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api("/admin/content/collection-pages")
      .then((d) => {
        setPages(d.pages ?? [])
        setDesigns(d.designsByCollection ?? {})
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  function patch(id: string, key: keyof Page, value: unknown) {
    setPages((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [key]: value } : r))
    )
  }

  async function save(page: Page) {
    try {
      const d = await api(`/admin/content/collection-pages/${page.id}`, {
        method: "POST",
        body: JSON.stringify({
          hero_image_url: page.hero_image_url ?? "",
          hero_eyebrow: page.hero_eyebrow ?? "",
          hero_heading: page.hero_heading ?? "",
          cta_label: page.cta_label ?? "",
          cta_href: page.cta_href ?? "",
          intro_heading: page.intro_heading ?? "",
          intro_copy: page.intro_copy ?? "",
          design_slugs: page.design_slugs ?? [],
        }),
      })
      setPages(d.pages)
      toast.success(`${page.collection_slug} saved`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function toggle(page: Page, visible: boolean) {
    try {
      const d = await api(`/admin/content/collection-pages/${page.id}`, {
        method: "POST",
        body: JSON.stringify({ is_visible: visible }),
      })
      setPages(d.pages)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  /** Ordered chosen designs, then the rest of the collection's designs. */
  function ordering(page: Page) {
    const all = designs[page.collection_slug] ?? []
    const chosen = (page.design_slugs ?? []).filter((s) =>
      all.some((d) => d.slug === s)
    )
    const rest = all.filter((d) => !chosen.includes(d.slug)).map((d) => d.slug)
    return { all, chosen, rest }
  }

  function move(page: Page, index: number, delta: number) {
    const { chosen } = ordering(page)
    const next = index + delta
    if (next < 0 || next >= chosen.length) return
    const order = [...chosen]
    const [moved] = order.splice(index, 1)
    order.splice(next, 0, moved)
    patch(page.id, "design_slugs", order)
  }

  if (loading) {
    return (
      <Container>
        <Text>Loading collection pages...</Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Collection pages</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            One template, twelve collections. Each page is served at
            /collection/&lt;slug&gt;/. Leave the hero image blank to use the
            collection&rsquo;s own artwork, and leave the design list empty to
            show every design in catalogue order.
          </Text>
        </div>
      </Container>

      {pages.map((page) => {
        const { all, chosen, rest } = ordering(page)
        const isOpen = openId === page.id
        return (
          <Container key={page.id} className="divide-y p-0">
            <div className="flex flex-wrap items-center gap-3 px-6 py-4">
              <div className="min-w-56">
                <Text size="small" weight="plus">
                  {page.collection_slug}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  /collection/{page.collection_slug}/
                </Text>
              </div>
              <Badge size="2xsmall">
                {chosen.length ? `${chosen.length} chosen` : `all ${all.length}`}
              </Badge>
              {!page.hero_image_url ? (
                <Badge size="2xsmall">hero from artwork</Badge>
              ) : null}
              <div className="ml-auto flex items-center gap-x-3">
                <Label size="small">Shown</Label>
                <Switch
                  checked={page.is_visible}
                  onCheckedChange={(v) => toggle(page, v)}
                />
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => setOpenId(isOpen ? null : page.id)}
                >
                  {isOpen ? "Close" : "Edit"}
                </Button>
              </div>
            </div>

            {isOpen ? (
              <>
                <div className="grid gap-4 px-6 py-4 md:grid-cols-2">
                  {(
                    [
                      ["hero_eyebrow", "Hero eyebrow"],
                      ["hero_heading", "Hero heading"],
                      ["cta_label", "Button label"],
                      ["cta_href", "Button link"],
                      ["intro_heading", "Section heading"],
                      ["hero_image_url", "Hero image URL (blank = use artwork)"],
                    ] as [keyof Page, string][]
                  ).map(([key, label]) => (
                    <div key={String(key)}>
                      <Label size="small">{label}</Label>
                      <Input
                        value={(page[key] as string) ?? ""}
                        onChange={(e) => patch(page.id, key, e.target.value)}
                      />
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <Label size="small">Intro copy</Label>
                    <Textarea
                      rows={3}
                      value={page.intro_copy ?? ""}
                      onChange={(e) => patch(page.id, "intro_copy", e.target.value)}
                    />
                  </div>
                </div>

                <div className="px-6 py-4">
                  <Text size="small" weight="plus">
                    Designs on this page
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Empty means every design in the collection. Add one to start
                    curating; order here is order on the page.
                  </Text>

                  <div className="mt-3 flex flex-col gap-y-1">
                    {chosen.map((slug, i) => {
                      const design = all.find((d) => d.slug === slug)
                      return (
                        <div key={slug} className="flex items-center gap-x-2">
                          <Button
                            size="small"
                            variant="transparent"
                            disabled={i === 0}
                            onClick={() => move(page, i, -1)}
                            aria-label="Move up"
                          >
                            ↑
                          </Button>
                          <Button
                            size="small"
                            variant="transparent"
                            disabled={i === chosen.length - 1}
                            onClick={() => move(page, i, 1)}
                            aria-label="Move down"
                          >
                            ↓
                          </Button>
                          <Text size="small" className="flex-1">
                            {design?.name ?? slug}
                          </Text>
                          <Button
                            size="small"
                            variant="transparent"
                            onClick={() =>
                              patch(
                                page.id,
                                "design_slugs",
                                chosen.filter((s) => s !== slug)
                              )
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      )
                    })}
                    {!chosen.length ? (
                      <Text size="small" className="text-ui-fg-subtle">
                        Showing all {all.length} designs in catalogue order.
                      </Text>
                    ) : null}
                  </div>

                  {rest.length ? (
                    <div className="mt-4">
                      <Label size="small">Add a design</Label>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {rest.map((slug) => {
                          const design = all.find((d) => d.slug === slug)
                          return (
                            <Button
                              key={slug}
                              size="small"
                              variant="secondary"
                              onClick={() =>
                                patch(page.id, "design_slugs", [...chosen, slug])
                              }
                            >
                              + {design?.name ?? slug}
                            </Button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex justify-end gap-x-2 px-6 py-3">
                  <a
                    href={`http://localhost:8000/collection/${page.collection_slug}/`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <Button size="small" variant="transparent">
                      View page
                    </Button>
                  </a>
                  <Button size="small" variant="secondary" onClick={() => save(page)}>
                    Save
                  </Button>
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
