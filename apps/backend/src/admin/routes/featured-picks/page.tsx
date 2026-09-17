import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Heart } from "@medusajs/icons"
import {
  Button,
  Checkbox,
  Container,
  Heading,
  IconButton,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

type Pick = { id: string; handle: string; position: number }
type Design = { slug: string; name: string; live?: boolean }

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

const FeaturedPicksPage = () => {
  const [picks, setPicks] = useState<Pick[]>([])
  const [designs, setDesigns] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [showAll, setShowAll] = useState(false)

  function loadPicks() {
    return api("/admin/content/featured-picks")
      .then((d) => setPicks(d.picks ?? []))
      .catch((e) => toast.error(e.message))
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      loadPicks(),
      api("/admin/designs")
        .then((d) =>
          setDesigns(
            (d.designs ?? []).sort((a: Design, b: Design) =>
              a.name.localeCompare(b.name)
            )
          )
        )
        .catch(() => undefined),
    ]).finally(() => setLoading(false))
  }, [])

  const designName = (handle: string) =>
    designs.find((d) => d.slug === handle)?.name ?? handle

  const liveCount = useMemo(
    () => designs.filter((d) => d.live).length,
    [designs]
  )

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = showAll ? designs : designs.filter((d) => d.live)
    // Hide designs already picked.
    const picked = new Set(picks.map((p) => p.handle))
    list = list.filter((d) => !picked.has(d.slug))
    if (q) {
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)
      )
    }
    return list.slice(0, 80)
  }, [designs, query, showAll, picks])

  async function add(slug: string) {
    setBusy(true)
    try {
      const res = await api("/admin/content/featured-picks", {
        method: "POST",
        body: JSON.stringify({ handle: slug }),
      })
      setPicks(res.picks ?? [])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      const res = await api(`/admin/content/featured-picks/${id}`, {
        method: "DELETE",
      })
      setPicks(res.picks ?? [])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function move(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= picks.length) return
    const order = picks.map((p) => p.id)
    ;[order[index], order[next]] = [order[next], order[index]]
    setPicks(order.map((id) => picks.find((p) => p.id === id)!))
    try {
      const res = await api("/admin/content/featured-picks/reorder", {
        method: "POST",
        body: JSON.stringify({ order }),
      })
      setPicks(res.picks ?? [])
    } catch (e: any) {
      toast.error(e.message)
      loadPicks()
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">We think you'll love</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Hand-picked designs shown in the &ldquo;We think you&rsquo;ll
          love&rdquo; row on every product page. Each follows the customer&rsquo;s
          live device and case type. Click a design to add it; reorder with the
          arrows.
        </Text>
      </div>

      <div className="grid gap-4 px-6 py-4 md:grid-cols-2">
        {/* Design picker */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label size="xsmall" weight="plus">
              Add a design
            </Label>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="show-all"
                checked={showAll}
                onCheckedChange={(v) => setShowAll(!!v)}
              />
              <Label htmlFor="show-all" size="xsmall" className="text-ui-fg-muted">
                Show all ({designs.length})
              </Label>
            </div>
          </div>
          <Input
            placeholder={`Search ${showAll ? designs.length : liveCount} designs…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-ui-border-base">
            {matching.map((d) => (
              <button
                key={d.slug}
                type="button"
                disabled={busy}
                onClick={() => add(d.slug)}
                className="hover:bg-ui-bg-subtle flex w-full items-center justify-between px-3 py-2 text-left text-sm"
              >
                <span>{d.name}</span>
                <span
                  className={`text-xs ${
                    d.live ? "text-ui-fg-interactive" : "text-ui-fg-muted"
                  }`}
                >
                  {d.live ? "+ add" : "not live"}
                </span>
              </button>
            ))}
            {matching.length === 0 ? (
              <Text size="xsmall" className="text-ui-fg-muted px-3 py-3">
                No design to add.
              </Text>
            ) : null}
          </div>
        </div>

        {/* Current picks */}
        <div className="flex flex-col gap-2">
          <Label size="xsmall" weight="plus">
            Picked ({picks.length})
          </Label>
          {loading ? (
            <Text size="small">Loading&hellip;</Text>
          ) : picks.length === 0 ? (
            <Text size="small" className="text-ui-fg-muted">
              No picks yet. Add a design from the left.
            </Text>
          ) : (
            <div className="flex flex-col gap-1">
              {picks.map((p, index) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-ui-border-base px-2 py-1.5"
                >
                  <div className="flex flex-col">
                    <IconButton
                      size="small"
                      variant="transparent"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label="Move up"
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      size="small"
                      variant="transparent"
                      disabled={index === picks.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </IconButton>
                  </div>
                  <Text size="small" weight="plus" className="flex-1">
                    {designName(p.handle)}
                  </Text>
                  <IconButton
                    size="small"
                    variant="transparent"
                    disabled={busy}
                    onClick={() => remove(p.id)}
                    aria-label="Remove"
                  >
                    ✕
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "We think you'll love",
  icon: Heart,
})

export default FeaturedPicksPage
