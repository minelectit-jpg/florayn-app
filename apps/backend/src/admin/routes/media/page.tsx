import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type Row = {
  id: string
  handle: string
  title: string
  thumbnail: string | null
  design: string | null
  case_type: string | null
  variants: number
  with_images: number
  missing: number
}

type DeviceGroup = {
  variant_id: string
  device: string
  device_slug: string | null
  images: string[]
}

type Detail = {
  id: string
  handle: string
  title: string
  design: string | null
  case_type: string | null
  devices: DeviceGroup[]
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

/**
 * Media manager. Product imagery is per device: each variant carries its own
 * gallery, so this is the place to see what a device has, replace a render,
 * add one for a device that has none, and reorder.
 */
const MediaPage = () => {
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState("")
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})

  function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (onlyMissing) params.set("missing", "1")
    api(`/admin/media?${params}`)
      .then((d) => {
        setRows(d.products ?? [])
        setTotal(d.total ?? 0)
        setTotals(d.totals ?? {})
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [onlyMissing])

  async function open(id: string) {
    try {
      const d = await api(`/admin/media/${id}`)
      setDetail(d.product)
      // One textarea per device, one URL per line - the simplest thing that
      // covers replace, add and reorder without a drag-and-drop library.
      const next: Record<string, string> = {}
      for (const g of d.product.devices) next[g.variant_id] = g.images.join("\n")
      setDraft(next)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function save(group: DeviceGroup) {
    if (!detail) return
    const images = (draft[group.variant_id] ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      const d = await api(`/admin/media/${detail.id}`, {
        method: "POST",
        body: JSON.stringify({ variant_id: group.variant_id, images }),
      })
      setDetail(d.product)
      toast.success(`${group.device} saved`)
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  function move(group: DeviceGroup, index: number, delta: number) {
    const lines = (draft[group.variant_id] ?? "").split(/\r?\n/).filter(Boolean)
    const next = index + delta
    if (next < 0 || next >= lines.length) return
    const [moved] = lines.splice(index, 1)
    lines.splice(next, 0, moved)
    setDraft({ ...draft, [group.variant_id]: lines.join("\n") })
  }

  if (detail) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading level="h1">{detail.title}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {detail.design} &middot; {detail.case_type} &middot;{" "}
                {detail.devices.length} devices
              </Text>
            </div>
            <Button variant="secondary" onClick={() => setDetail(null)}>
              Back to all products
            </Button>
          </div>
        </Container>

        {detail.devices.map((group) => {
          const lines = (draft[group.variant_id] ?? "").split(/\r?\n/).filter(Boolean)
          return (
            <Container key={group.variant_id} className="divide-y p-0">
              <div className="flex items-center gap-3 px-6 py-3">
                <Text size="small" weight="plus">
                  {group.device}
                </Text>
                {group.device_slug ? (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {group.device_slug}
                  </Text>
                ) : null}
                {lines.length ? (
                  <Badge size="2xsmall">{lines.length} image{lines.length === 1 ? "" : "s"}</Badge>
                ) : (
                  <Badge size="2xsmall" color="red">
                    no image
                  </Badge>
                )}
              </div>

              <div className="px-6 py-4">
                {lines.length ? (
                  <div className="mb-3 flex flex-wrap gap-3">
                    {lines.map((url, i) => (
                      <div key={url + i} className="w-[104px]">
                        <img
                          src={url}
                          alt=""
                          className="h-[104px] w-[104px] rounded-md border object-contain"
                        />
                        <div className="mt-1 flex justify-center gap-1">
                          <Button
                            size="small"
                            variant="transparent"
                            disabled={i === 0}
                            onClick={() => move(group, i, -1)}
                            aria-label="Move left"
                          >
                            ←
                          </Button>
                          <Button
                            size="small"
                            variant="transparent"
                            disabled={i === lines.length - 1}
                            onClick={() => move(group, i, 1)}
                            aria-label="Move right"
                          >
                            →
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <Label size="small">
                  Image URLs, one per line &mdash; order here is order on the page
                </Label>
                <Textarea
                  rows={Math.min(6, Math.max(2, lines.length + 1))}
                  value={draft[group.variant_id] ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, [group.variant_id]: e.target.value })
                  }
                  placeholder="https://img.florayn.com/design/case-type/device/1.webp"
                />
                <div className="mt-2 flex justify-end">
                  <Button size="small" variant="secondary" onClick={() => save(group)}>
                    Save {group.device}
                  </Button>
                </div>
              </div>
            </Container>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">Media</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Imagery is per device. {totals.variants?.toLocaleString() ?? "-"}{" "}
            device galleries across {totals.products ?? "-"} products
            {totals.missing ? `, ${totals.missing.toLocaleString()} with no image` : ", all filled"}.
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <Input
            className="w-72"
            placeholder="Search design, case type or handle"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <Button size="small" variant="secondary" onClick={load}>
            Search
          </Button>
          <Button
            size="small"
            variant={onlyMissing ? "primary" : "transparent"}
            onClick={() => setOnlyMissing((v) => !v)}
          >
            {onlyMissing ? "Showing gaps only" : "Show gaps only"}
          </Button>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {total} matching{total > rows.length ? `, first ${rows.length} shown` : ""}
          </Text>
        </div>
      </Container>

      {loading ? (
        <Container>
          <Text>Loading...</Text>
        </Container>
      ) : (
        rows.map((row) => (
          <Container key={row.id} className="p-0">
            <div className="flex items-center gap-4 px-6 py-3">
              {row.thumbnail ? (
                <img
                  src={row.thumbnail}
                  alt=""
                  className="size-12 rounded-md border object-contain"
                />
              ) : (
                <div className="size-12 rounded-md border" />
              )}
              <div className="min-w-56">
                <Text size="small" weight="plus">
                  {row.design}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {row.case_type}
                </Text>
              </div>
              <Badge size="2xsmall">
                {row.with_images}/{row.variants} devices
              </Badge>
              {row.missing ? (
                <Badge size="2xsmall" color="red">
                  {row.missing} missing
                </Badge>
              ) : null}
              <div className="ml-auto">
                <Button size="small" variant="secondary" onClick={() => open(row.id)}>
                  Manage images
                </Button>
              </div>
            </div>
          </Container>
        ))
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Media",
  icon: Photo,
})

export default MediaPage
