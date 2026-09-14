import { defineRouteConfig } from "@medusajs/admin-sdk"
import { SquaresPlus } from "@medusajs/icons"
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

type Blank = {
  id: string
  sku: string
  case_type_name: string | null
  device_name: string
  location_id: string | null
  stocked: number
  reserved: number
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

const StockPage = () => {
  const [blanks, setBlanks] = useState<Blank[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api("/admin/stock")
      .then((d) => {
        const list: Blank[] = d.blanks ?? []
        setBlanks(list)
        setDraft(Object.fromEntries(list.map((b) => [b.id, String(b.stocked)])))
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function save(b: Blank) {
    const qty = Number(draft[b.id])
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error("Enter a valid quantity")
      return
    }
    if (!b.location_id) {
      toast.error("This blank has no warehouse level yet")
      return
    }
    setSaving(b.id)
    try {
      await api(`/admin/stock/${b.id}`, {
        method: "POST",
        body: JSON.stringify({
          location_id: b.location_id,
          stocked_quantity: qty,
        }),
      })
      setBlanks((list) =>
        list.map((x) => (x.id === b.id ? { ...x, stocked: qty } : x))
      )
      toast.success(`${b.case_type_name} - ${b.device_name}: ${qty} in stock`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(null)
    }
  }

  // Group by case type, each with its device rows.
  const groups = useMemo(() => {
    const map = new Map<string, Blank[]>()
    for (const b of blanks) {
      const key = b.case_type_name ?? "Other"
      ;(map.get(key) ?? map.set(key, []).get(key)!).push(b)
    }
    return [...map.entries()]
  }, [blanks])

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Stock</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Stock is held per BLANK &mdash; a case type on one device, e.g.
          &ldquo;Signature &middot; iPhone 17 Pro Max&rdquo;. Every design printed
          on that blank shares this one pool, so when it hits zero every design
          goes out of stock for that case type + device together.
        </Text>
      </div>

      {loading ? (
        <div className="px-6 py-4">
          <Text size="small">Loading&hellip;</Text>
        </div>
      ) : (
        groups.map(([caseType, items]) => (
          <div key={caseType} className="px-6 py-4">
            <div className="mb-2 flex items-center gap-2">
              <Text size="small" weight="plus">
                {caseType}
              </Text>
              <Badge size="2xsmall" color="grey">
                {items.length} devices
              </Badge>
            </div>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Device</Table.HeaderCell>
                  <Table.HeaderCell>In stock</Table.HeaderCell>
                  <Table.HeaderCell>Reserved</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((b) => (
                  <Table.Row key={b.id}>
                    <Table.Cell>
                      <Text size="small">{b.device_name}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        value={draft[b.id] ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [b.id]: e.target.value }))
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small" className="text-ui-fg-muted">
                        {b.reserved}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        size="small"
                        variant="secondary"
                        isLoading={saving === b.id}
                        disabled={
                          !!saving || Number(draft[b.id]) === b.stocked
                        }
                        onClick={() => save(b)}
                      >
                        Save
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        ))
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Stock",
  icon: SquaresPlus,
})

export default StockPage
