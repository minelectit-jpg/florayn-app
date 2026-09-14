import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Sparkles } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

type Design = {
  slug: string
  name: string
  theme: string | null
  caseTypes: string[]
  live: boolean
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

const NewDesignPage = () => {
  const [designs, setDesigns] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [onlyPending, setOnlyPending] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api("/admin/designs")
      .then((d) => setDesigns(d.designs ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function add(design: Design) {
    setAdding(design.slug)
    try {
      const d = await api("/admin/designs", {
        method: "POST",
        body: JSON.stringify({ slug: design.slug }),
      })
      const r = d.result
      setDesigns((list) =>
        list.map((x) => (x.slug === design.slug ? { ...x, live: true } : x))
      )
      toast.success(
        `${design.name}: ${r.products.length} product(s), ${r.variants} variants, ` +
          `${r.imagesWired} images wired.`
      )
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAdding(null)
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return designs.filter((d) => {
      if (onlyPending && d.live) return false
      if (needle && !d.name.toLowerCase().includes(needle) && !d.slug.includes(needle)) {
        return false
      }
      return true
    })
  }, [designs, q, onlyPending])

  const liveCount = designs.filter((d) => d.live).length

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">New design</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Add a design to the store in one click: it builds the phone case (and
          AirPods etc.) product with Case Type + Device options, only the
          combinations that are sold, shared blank stock, and wires its images.
          Use this to publish the rest of the catalogue design by design.
        </Text>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-6 py-3">
        <Input
          placeholder="Search designs&hellip;"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Button
          variant={onlyPending ? "primary" : "secondary"}
          size="small"
          onClick={() => setOnlyPending((v) => !v)}
        >
          {onlyPending ? "Showing not-yet-added" : "Showing all"}
        </Button>
        <Badge color="grey">
          {liveCount} / {designs.length} live
        </Badge>
      </div>

      <div className="px-6 py-4">
        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Design</Table.HeaderCell>
                <Table.HeaderCell>Collection</Table.HeaderCell>
                <Table.HeaderCell>Case types</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filtered.map((d) => (
                <Table.Row key={d.slug}>
                  <Table.Cell>
                    <Text size="small" weight="plus" className="capitalize">
                      {d.name}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-muted">
                      {d.theme ?? "-"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {d.caseTypes.length}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {d.live ? (
                      <Badge size="2xsmall" color="green">
                        Live
                      </Badge>
                    ) : (
                      <Button
                        size="small"
                        variant="secondary"
                        isLoading={adding === d.slug}
                        disabled={!!adding}
                        onClick={() => add(d)}
                      >
                        Add to store
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "New design",
  icon: Sparkles,
})

export default NewDesignPage
