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
import { useEffect, useState } from "react"

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

/** A one-line summary of what a section holds, so the list reads at a glance. */
function summarise(section: Section): string {
  const config = section.config ?? {}
  switch (section.type) {
    case "category_pills":
      return `${config.items?.length ?? 0} pills`
    case "hero":
      return `${config.slides?.length ?? 0} slides`
    case "tile_grid":
      return `${config.tiles?.length ?? 0} tiles, ${config.columns ?? "?"} across`
    case "testimonials":
      return `${config.quotes?.length ?? 0} quotes`
    case "product_carousel":
      return `${config.limit ?? 0} products`
    case "marquee":
      return "scrolling strip"
    default:
      return section.type
  }
}

const HomeSectionsPage = () => {
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    api("/admin/content")
      .then((d) => setSections(d.sections ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const ordered = [...sections].sort((a, b) => a.position - b.position)

  async function reorder(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= ordered.length) return
    const order = [...ordered]
    const [moved] = order.splice(index, 1)
    order.splice(next, 0, moved)
    try {
      const d = await api("/admin/content/home-sections", {
        method: "POST",
        body: JSON.stringify({ order: order.map((s) => s.id) }),
      })
      setSections(d.sections)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function save(section: Section) {
    try {
      const d = await api(`/admin/content/home-sections/${section.id}`, {
        method: "POST",
        body: JSON.stringify({
          title: section.title ?? "",
          subtitle: section.subtitle ?? "",
          eyebrow: section.eyebrow ?? "",
          cta_label: section.cta_label ?? "",
          cta_href: section.cta_href ?? "",
        }),
      })
      setSections(d.sections)
      toast.success(`${section.key} saved`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function toggle(section: Section, visible: boolean) {
    try {
      const d = await api(`/admin/content/home-sections/${section.id}`, {
        method: "POST",
        body: JSON.stringify({ is_visible: visible }),
      })
      setSections(d.sections)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  function patch(id: string, key: keyof Section, value: string) {
    setSections((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [key]: value } : r))
    )
  }

  if (loading) {
    return (
      <Container>
        <Text>Loading home page...</Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Home page</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Reorder the bands, hide one, or edit its copy. The order here is the
            order on the site.
          </Text>
        </div>
      </Container>

      {ordered.map((section, index) => (
        <Container key={section.id} className="divide-y p-0">
          <div className="flex flex-wrap items-center gap-3 px-6 py-4">
            <div className="flex gap-x-1">
              <Button
                size="small"
                variant="transparent"
                disabled={index === 0}
                onClick={() => reorder(index, -1)}
                aria-label="Move up"
              >
                ↑
              </Button>
              <Button
                size="small"
                variant="transparent"
                disabled={index === ordered.length - 1}
                onClick={() => reorder(index, 1)}
                aria-label="Move down"
              >
                ↓
              </Button>
            </div>

            <div className="min-w-52">
              <Text size="small" weight="plus">
                {section.key}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {summarise(section)}
              </Text>
            </div>

            <Badge size="2xsmall">{section.type}</Badge>

            <div className="ml-auto flex items-center gap-x-3">
              <Label size="small">Shown</Label>
              <Switch
                checked={section.is_visible}
                onCheckedChange={(v) => toggle(section, v)}
              />
            </div>
          </div>

          <div className="grid gap-3 px-6 py-4 md:grid-cols-2">
            {(
              [
                ["eyebrow", "Eyebrow"],
                ["title", "Title"],
                ["subtitle", "Subtitle"],
                ["cta_label", "Button label"],
                ["cta_href", "Button link"],
              ] as [keyof Section, string][]
            ).map(([key, label]) => (
              <div key={String(key)}>
                <Label size="small">{label}</Label>
                <Input
                  value={(section[key] as string) ?? ""}
                  onChange={(e) => patch(section.id, key, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end px-6 py-3">
            <Button size="small" variant="secondary" onClick={() => save(section)}>
              Save
            </Button>
          </div>
        </Container>
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Home page",
  icon: SquaresPlus,
})

export default HomeSectionsPage
