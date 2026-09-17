import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Sparkles } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

import MediaPicker from "../../components/media-picker"

type Block = {
  id: string
  case_type: string | null
  title: string | null
  description: string | null
  image_url: string | null
  video_url: string | null
  position: number
  is_visible: boolean
}

type Draft = {
  case_type: string
  title: string
  description: string
  image_url: string
  video_url: string
}

/** The sentinel a Select uses for "no case type" (a Select can't hold ""). */
const ALL = "__all__"

/**
 * Product-type groups for non-phone forms. These labels must match the
 * storefront's product-type labels, so an "AirPods" block shows on AirPods
 * pages. New types can be added on the fly with "Add type".
 */
const PRODUCT_TYPES = [
  "AirPods",
  "Sticky Pad",
  "Card Holder",
  "Ring Holder",
  "Phone Charm",
  "Watch Band",
  "Wallet",
]

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
  case_type: b.case_type ?? "",
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
  const [caseTypes, setCaseTypes] = useState<string[]>([])
  // The group currently being edited. "" is the Default (all case types) set.
  const [selectedTab, setSelectedTab] = useState<string>("")
  // Product-type groups the owner adds on the fly ("Add type").
  const [customTypes, setCustomTypes] = useState<string[]>([])
  const [picker, setPicker] = useState<{
    id: string
    field: "image_url" | "video_url"
  } | null>(null)

  // The case-type names, used to tag each block. These are the same values the
  // storefront's case-type selector uses, so a tagged block shows only for that
  // construction.
  useEffect(() => {
    api("/admin/case-types")
      .then((d) => {
        const names = (d.case_types ?? [])
          .map((c: any) => c.name)
          .filter(Boolean)
        setCaseTypes(names)
      })
      .catch(() => undefined)
  }, [])

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
      d.case_type !== (row.case_type ?? "") ||
      d.title !== (row.title ?? "") ||
      d.description !== (row.description ?? "") ||
      d.image_url !== (row.image_url ?? "") ||
      d.video_url !== (row.video_url ?? "")
    )
  }

  async function addBlock() {
    setAdding(true)
    try {
      const res = await api("/admin/content/feature-blocks", {
        method: "POST",
        body: JSON.stringify({ case_type: selectedTab }),
      })
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

  // Reorder within the current case-type group only. The two blocks swap, and
  // the full id order (other groups untouched) is sent to the server.
  async function move(visibleIndex: number, delta: number) {
    const visible = rows.filter((b) => (b.case_type ?? "") === selectedTab)
    const next = visibleIndex + delta
    if (next < 0 || next >= visible.length) return
    const visIds = visible.map((b) => b.id)
    ;[visIds[visibleIndex], visIds[next]] = [visIds[next], visIds[visibleIndex]]
    const visSet = new Set(visible.map((b) => b.id))
    let vi = 0
    const order = rows.map((b) => (visSet.has(b.id) ? visIds[vi++] : b.id))
    // Optimistic: reflect the new order immediately.
    setRows(order.map((id) => rows.find((b) => b.id === id)!))
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

  const visibleRows = rows.filter((r) => (r.case_type ?? "") === selectedTab)

  // Every group that gets a tab: case types, product types, any the owner added,
  // and any already used by a block (so nothing is orphaned).
  const blockGroups = rows.map((r) => r.case_type).filter(Boolean) as string[]
  const caseTypeGroups = [...caseTypes]
  const productGroups = [
    ...new Set([
      ...PRODUCT_TYPES,
      ...customTypes,
      ...blockGroups.filter(
        (g) => !caseTypes.includes(g) && !PRODUCT_TYPES.includes(g)
      ),
    ]),
  ]
  const allGroups = [...caseTypeGroups, ...productGroups]

  function addType() {
    const name = window.prompt("New product type name (e.g. Ring Holder)")?.trim()
    if (!name) return
    if (!allGroups.includes(name)) setCustomTypes((t) => [...t, name])
    setSelectedTab(name)
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Product features</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          The blocks in the &ldquo;Features&rdquo; band on the product page. Pick
          a group below to edit its own set: a <b>case type</b> drives phone
          products (Signature its own, Armor another), a <b>product type</b>{" "}
          drives AirPods, sticky pads and the rest — and <b>+ Add type</b> makes
          a new one for a future product. <b>Default</b> shows where a group has
          none of its own. Give a block a <b>video URL</b> to autoplay on loop
          with no controls, or an <b>image URL</b> for a still.
        </Text>
      </div>

      {/* Group tabs — each is its own content set. Case types drive phone
          products; product types drive AirPods, sticky pads and the rest. */}
      <div className="flex flex-col gap-2 px-6 py-3">
        {(() => {
          const tabButton = (label: string, value: string) => {
            const count = rows.filter(
              (r) => (r.case_type ?? "") === value
            ).length
            return (
              <Button
                key={value || "__default__"}
                size="small"
                variant={selectedTab === value ? "primary" : "secondary"}
                onClick={() => setSelectedTab(value)}
              >
                {label}
                {count ? ` (${count})` : ""}
              </Button>
            )
          }
          return (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {tabButton("Default (all)", "")}
                {caseTypeGroups.map((g) => tabButton(g, g))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Text size="xsmall" className="self-center text-ui-fg-muted">
                  Product types:
                </Text>
                {productGroups.map((g) => tabButton(g, g))}
                <Button size="small" variant="transparent" onClick={addType}>
                  + Add type
                </Button>
              </div>
            </>
          )
        })()}
      </div>

      <div className="flex flex-col gap-4 px-6 py-4">
        <div className="flex items-center justify-between">
          <Text size="small" weight="plus">
            {selectedTab
              ? `“${selectedTab}” blocks`
              : "Default blocks (shown for any case type without its own)"}
          </Text>
          <Button variant="secondary" isLoading={adding} onClick={addBlock}>
            Add block{selectedTab ? ` to ${selectedTab}` : ""}
          </Button>
        </div>

        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : visibleRows.length === 0 ? (
          <Text size="small" className="text-ui-fg-muted">
            No blocks for {selectedTab ? `“${selectedTab}”` : "the default set"}{" "}
            yet. Click &ldquo;Add block&rdquo; to start.
          </Text>
        ) : (
          visibleRows.map((row, index) => {
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
                    disabled={index === visibleRows.length - 1}
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
                  <div className="flex items-center gap-2">
                    <Text size="xsmall" className="shrink-0 text-ui-fg-muted">
                      Group
                    </Text>
                    <Select
                      value={d.case_type || ALL}
                      onValueChange={(v) =>
                        edit(row.id, "case_type", v === ALL ? "" : v)
                      }
                    >
                      <Select.Trigger className="w-56">
                        <Select.Value placeholder="All case types" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value={ALL}>
                          All case types (default)
                        </Select.Item>
                        {allGroups.map((name) => (
                          <Select.Item key={name} value={name}>
                            {name}
                          </Select.Item>
                        ))}
                        {d.case_type && !allGroups.includes(d.case_type) ? (
                          <Select.Item value={d.case_type}>
                            {d.case_type}
                          </Select.Item>
                        ) : null}
                      </Select.Content>
                    </Select>
                  </div>
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
