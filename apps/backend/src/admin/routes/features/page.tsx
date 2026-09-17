import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Sparkles } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

import MediaPicker from "../../components/media-picker"

type Block = {
  id: string
  title: string | null
  description: string | null
  image_url: string | null
  video_url: string | null
  position: number
  is_visible: boolean
}

type Draft = {
  title: string
  description: string
  image_url: string
  video_url: string
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

const toDraft = (b: Block): Draft => ({
  title: b.title ?? "",
  description: b.description ?? "",
  image_url: b.image_url ?? "",
  video_url: b.video_url ?? "",
})

const FeaturesPage = () => {
  const [rows, setRows] = useState<Block[]>([])
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [picker, setPicker] = useState<{
    id: string
    field: "image_url" | "video_url"
  } | null>(null)

  function apply(list: Block[]) {
    setRows(list)
    setDraft(Object.fromEntries(list.map((b) => [b.id, toDraft(b)])))
  }

  function load() {
    setLoading(true)
    api("/admin/content/feature-blocks")
      .then((d) => apply(d.blocks ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  function edit(id: string, field: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [field]: value } }))
  }

  const dirty = (row: Block) => {
    const d = draft[row.id]
    if (!d) return false
    return (
      d.title !== (row.title ?? "") ||
      d.description !== (row.description ?? "") ||
      d.image_url !== (row.image_url ?? "") ||
      d.video_url !== (row.video_url ?? "")
    )
  }

  async function addBlock() {
    setAdding(true)
    try {
      const res = await api("/admin/content/feature-blocks", { method: "POST" })
      apply(res.blocks ?? [])
      toast.success("Block added.")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAdding(false)
    }
  }

  async function save(row: Block) {
    const d = draft[row.id]
    setSaving(row.id)
    try {
      const res = await api(`/admin/content/feature-blocks/${row.id}`, {
        method: "POST",
        body: JSON.stringify(d),
      })
      apply(res.blocks ?? [])
      toast.success("Saved.")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(null)
    }
  }

  async function toggle(row: Block, is_visible: boolean) {
    try {
      const res = await api(`/admin/content/feature-blocks/${row.id}`, {
        method: "POST",
        body: JSON.stringify({ is_visible }),
      })
      apply(res.blocks ?? [])
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function remove(row: Block) {
    if (!confirm("Remove this feature block?")) return
    setSaving(row.id)
    try {
      const res = await api(`/admin/content/feature-blocks/${row.id}`, {
        method: "DELETE",
      })
      apply(res.blocks ?? [])
      toast.success("Removed.")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(null)
    }
  }

  async function move(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= rows.length) return
    const order = rows.map((b) => b.id)
    ;[order[index], order[next]] = [order[next], order[index]]
    // Optimistic: reflect the new order immediately.
    const reordered = order.map((id) => rows.find((b) => b.id === id)!)
    setRows(reordered)
    try {
      const res = await api("/admin/content/feature-blocks/reorder", {
        method: "POST",
        body: JSON.stringify({ order }),
      })
      apply(res.blocks ?? [])
    } catch (e: any) {
      toast.error(e.message)
      load()
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-start justify-between px-6 py-4">
        <div>
          <Heading level="h1">Product features</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            The blocks in the &ldquo;Features&rdquo; band on every product page,
            below the recommendations. Give a block a <b>video URL</b> to have it
            autoplay on loop with no controls, or an <b>image URL</b> for a still.
            Title and description are optional. Reorder with the arrows; hide a
            block with its switch.
          </Text>
        </div>
        <Button variant="secondary" isLoading={adding} onClick={addBlock}>
          Add block
        </Button>
      </div>

      <div className="flex flex-col gap-4 px-6 py-4">
        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : rows.length === 0 ? (
          <Text size="small" className="text-ui-fg-muted">
            No blocks yet. Add one to start the Features band.
          </Text>
        ) : (
          rows.map((row, index) => {
            const d = draft[row.id] ?? toDraft(row)
            const preview = d.video_url || d.image_url
            return (
              <div
                key={row.id}
                className="flex gap-4 rounded-lg border border-ui-border-base p-4"
              >
                <div className="flex flex-col items-center gap-1 pt-1">
                  <IconButton
                    size="small"
                    variant="transparent"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </IconButton>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {index + 1}
                  </Text>
                  <IconButton
                    size="small"
                    variant="transparent"
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </IconButton>
                </div>

                <div className="h-24 w-24 shrink-0 overflow-hidden rounded bg-ui-bg-subtle">
                  {preview ? (
                    d.video_url ? (
                      <video
                        src={d.video_url}
                        muted
                        loop
                        playsInline
                        autoPlay
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={d.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Text size="xsmall" className="text-ui-fg-muted">
                        No media
                      </Text>
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  <Input
                    placeholder="Title (optional)"
                    value={d.title}
                    onChange={(e) => edit(row.id, "title", e.target.value)}
                  />
                  <Textarea
                    rows={2}
                    placeholder="Description (optional)"
                    value={d.description}
                    onChange={(e) => edit(row.id, "description", e.target.value)}
                  />
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Image URL"
                        value={d.image_url}
                        onChange={(e) =>
                          edit(row.id, "image_url", e.target.value)
                        }
                      />
                      <Button
                        size="small"
                        variant="secondary"
                        className="shrink-0"
                        onClick={() =>
                          setPicker({ id: row.id, field: "image_url" })
                        }
                      >
                        Choose
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Video URL (autoplay, no controls)"
                        value={d.video_url}
                        onChange={(e) =>
                          edit(row.id, "video_url", e.target.value)
                        }
                      />
                      <Button
                        size="small"
                        variant="secondary"
                        className="shrink-0"
                        onClick={() =>
                          setPicker({ id: row.id, field: "video_url" })
                        }
                      >
                        Choose
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.is_visible}
                        onCheckedChange={(v) => toggle(row, v)}
                      />
                      <Text size="small" className="text-ui-fg-subtle">
                        {row.is_visible ? "Visible" : "Hidden"}
                      </Text>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="small"
                        variant="danger"
                        disabled={saving === row.id}
                        onClick={() => remove(row)}
                      >
                        Remove
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        isLoading={saving === row.id}
                        disabled={!!saving || !dirty(row)}
                        onClick={() => save(row)}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <MediaPicker
        open={!!picker}
        onOpenChange={(o) => {
          if (!o) setPicker(null)
        }}
        accept={picker?.field === "video_url" ? "video" : "image"}
        title={
          picker?.field === "video_url" ? "Choose a video" : "Choose an image"
        }
        onSelect={(url) => {
          if (picker) edit(picker.id, picker.field, url)
        }}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Product features",
  icon: Sparkles,
})

export default FeaturesPage
