import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Input,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type CaseType = {
  id: string
  slug: string
  name: string
  description: string | null
  sku_code: string
  price: number
  sort_order: number
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

type Draft = { price: string; description: string }

const CaseTypesPage = () => {
  const [rows, setRows] = useState<CaseType[]>([])
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api("/admin/case-types")
      .then((d) => {
        const list: CaseType[] = d.case_types ?? []
        setRows(list)
        setDraft(
          Object.fromEntries(
            list.map((c) => [
              c.id,
              { price: String(c.price), description: c.description ?? "" },
            ])
          )
        )
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  function edit(id: string, field: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [field]: value } }))
  }

  async function save(row: CaseType) {
    const d = draft[row.id]
    const price = Number(d.price)
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Enter a valid price")
      return
    }
    setSaving(row.id)
    try {
      const res = await api(`/admin/case-types/${row.id}`, {
        method: "POST",
        body: JSON.stringify({ price, description: d.description }),
      })
      setRows((list) =>
        list.map((c) => (c.id === row.id ? res.case_type : c))
      )
      if (res.repriced) {
        toast.success(
          `Saved. Repriced ${res.repriced.variants} variants across ${res.repriced.products} products.`
        )
      } else {
        toast.success("Saved.")
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(null)
    }
  }

  const dirty = (row: CaseType) => {
    const d = draft[row.id]
    return d && (Number(d.price) !== row.price || d.description !== (row.description ?? ""))
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Case types</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          The constructions a design is sold in. Changing a price re-prices every
          variant of that case type across the whole catalogue, so the new price
          is what customers pay. Alcantara varies by device, so leave it unless
          you mean to make it a single flat price.
        </Text>
      </div>

      <div className="px-6 py-4">
        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Case type</Table.HeaderCell>
                <Table.HeaderCell>Price (৳)</Table.HeaderCell>
                <Table.HeaderCell>Description</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.id}>
                  <Table.Cell>
                    <Text size="small" weight="plus">
                      {row.name}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {row.sku_code}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Input
                      type="number"
                      min={1}
                      className="w-28"
                      value={draft[row.id]?.price ?? ""}
                      onChange={(e) => edit(row.id, "price", e.target.value)}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Textarea
                      rows={2}
                      className="min-w-[280px]"
                      value={draft[row.id]?.description ?? ""}
                      onChange={(e) =>
                        edit(row.id, "description", e.target.value)
                      }
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      size="small"
                      variant="secondary"
                      isLoading={saving === row.id}
                      disabled={!!saving || !dirty(row)}
                      onClick={() => save(row)}
                    >
                      Save
                    </Button>
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
  label: "Case types",
  icon: CurrencyDollar,
})

export default CaseTypesPage
