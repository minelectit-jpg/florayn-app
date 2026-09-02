import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Tag } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type Tier = {
  id: string
  quantity: number
  badge: string | null
  discount_amount: number
  min_pct: number
  max_pct: number
  is_enabled: boolean
  sort_order: number
}

type Settings = {
  id: string
  heading: string
  single_label: string
  free_shipping_threshold: number
  scope: string
  is_active: boolean
}

/**
 * Mirrors modules/bundles/pricing.ts so the preview column shows exactly what
 * a shopper will be charged. Keep the two in step.
 */
function tierPricing(unitPrice: number, tier: Tier) {
  const subtotal = unitPrice * Math.max(1, tier.quantity)
  let discount = Math.max(0, Math.round(tier.discount_amount))
  let applied = "flat"

  if (tier.min_pct > 0) {
    const floor = Math.round((subtotal * tier.min_pct) / 100)
    if (discount < floor) {
      discount = floor
      applied = "min %"
    }
  }
  if (tier.max_pct > 0) {
    const ceiling = Math.round((subtotal * tier.max_pct) / 100)
    if (discount > ceiling) {
      discount = ceiling
      applied = "max %"
    }
  }
  if (discount > subtotal) discount = subtotal

  return { subtotal, discount, total: subtotal - discount, applied }
}

const bdt = (n: number) => `${n.toLocaleString("en-US")}৳`

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body?.message ?? `Request failed (${res.status})`)
  }
  return body
}

const BundlesPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** Unit price the preview column is calculated against. */
  const [preview, setPreview] = useState(1950)

  function load() {
    setLoading(true)
    api("/admin/bundles")
      .then((data) => {
        setSettings(data.settings)
        setTiers(data.tiers)
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    try {
      const data = await api("/admin/bundles", {
        method: "POST",
        body: JSON.stringify({
          heading: settings.heading,
          single_label: settings.single_label,
          free_shipping_threshold: settings.free_shipping_threshold,
          is_active: settings.is_active,
        }),
      })
      setSettings(data.settings)
      setTiers(data.tiers)
      toast.success("Bundle settings saved")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveTier(tier: Tier) {
    try {
      const data = await api(`/admin/bundles/tiers/${tier.id}`, {
        method: "POST",
        body: JSON.stringify(tier),
      })
      setTiers(data.tiers)
      toast.success(`Tier of ${tier.quantity} saved`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function addTier() {
    try {
      const next = (tiers[tiers.length - 1]?.quantity ?? 1) + 1
      const data = await api("/admin/bundles/tiers", {
        method: "POST",
        body: JSON.stringify({
          quantity: next,
          discount_amount: 0,
          min_pct: 0,
          max_pct: 0,
          badge: null,
          is_enabled: false,
        }),
      })
      setTiers(data.tiers)
      toast.success("Tier added, switched off until you set its discount")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function removeTier(id: string, quantity: number) {
    if (!confirm(`Delete the ${quantity}-pack tier? This cannot be undone.`)) {
      return
    }
    try {
      const data = await api(`/admin/bundles/tiers/${id}`, { method: "DELETE" })
      setTiers(data.tiers)
      toast.success("Tier deleted")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  function patch(id: string, key: keyof Tier, value: unknown) {
    setTiers((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row))
    )
  }

  if (loading) {
    return (
      <Container>
        <Text>Loading bundle settings...</Text>
      </Container>
    )
  }

  if (!settings) {
    return (
      <Container>
        <Text>Could not load bundle settings.</Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Bundles</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Multi-buy tiers shown on every product page.
            </Text>
          </div>
          <div className="flex items-center gap-x-3">
            <Label htmlFor="active" size="small">
              Show the widget
            </Label>
            <Switch
              id="active"
              checked={settings.is_active}
              onCheckedChange={(v) =>
                setSettings({ ...settings, is_active: v })
              }
            />
          </div>
        </div>

        <div className="grid gap-4 px-6 py-4 md:grid-cols-3">
          <div>
            <Label size="small" htmlFor="heading">
              Widget heading
            </Label>
            <Input
              id="heading"
              value={settings.heading}
              onChange={(e) =>
                setSettings({ ...settings, heading: e.target.value })
              }
            />
          </div>
          <div>
            <Label size="small" htmlFor="single">
              Single-item label
            </Label>
            <Input
              id="single"
              value={settings.single_label}
              onChange={(e) =>
                setSettings({ ...settings, single_label: e.target.value })
              }
            />
          </div>
          <div>
            <Label size="small" htmlFor="freeship">
              Free shipping over (৳, 0 = off)
            </Label>
            <Input
              id="freeship"
              type="number"
              min={0}
              value={settings.free_shipping_threshold}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  free_shipping_threshold: Number(e.target.value),
                })
              }
            />
          </div>
        </div>

        <div className="flex justify-end px-6 py-4">
          <Button onClick={saveSettings} isLoading={saving}>
            Save settings
          </Button>
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Tiers</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              The flat discount is clamped to the percentage band, so one figure
              works across case types from 1,400৳ to 3,800৳.
            </Text>
          </div>
          <Button variant="secondary" onClick={addTier}>
            Add tier
          </Button>
        </div>

        <div className="flex items-center gap-x-3 px-6 py-3">
          <Label size="small" htmlFor="preview">
            Preview against unit price
          </Label>
          <Input
            id="preview"
            type="number"
            className="w-32"
            value={preview}
            onChange={(e) => setPreview(Number(e.target.value) || 0)}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            1,400 Signature &middot; 1,600 Elite Clear &middot; 1,950 Armor
            &middot; 3,800 Alcantara
          </Text>
        </div>

        <div className="overflow-x-auto px-6 py-4">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Qty</Table.HeaderCell>
                <Table.HeaderCell>Badge</Table.HeaderCell>
                <Table.HeaderCell>Discount ৳</Table.HeaderCell>
                <Table.HeaderCell>Min %</Table.HeaderCell>
                <Table.HeaderCell>Max %</Table.HeaderCell>
                <Table.HeaderCell>On</Table.HeaderCell>
                <Table.HeaderCell>Customer pays</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {tiers.map((tier) => {
                const p = tierPricing(preview, tier)
                return (
                  <Table.Row key={tier.id}>
                    <Table.Cell>
                      <Input
                        type="number"
                        className="w-16"
                        min={2}
                        value={tier.quantity}
                        onChange={(e) =>
                          patch(tier.id, "quantity", Number(e.target.value))
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        className="w-40"
                        placeholder="none"
                        value={tier.badge ?? ""}
                        onChange={(e) =>
                          patch(tier.id, "badge", e.target.value)
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        className="w-24"
                        min={0}
                        value={tier.discount_amount}
                        onChange={(e) =>
                          patch(
                            tier.id,
                            "discount_amount",
                            Number(e.target.value)
                          )
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        className="w-20"
                        min={0}
                        max={100}
                        value={tier.min_pct}
                        onChange={(e) =>
                          patch(tier.id, "min_pct", Number(e.target.value))
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        className="w-20"
                        min={0}
                        max={100}
                        value={tier.max_pct}
                        onChange={(e) =>
                          patch(tier.id, "max_pct", Number(e.target.value))
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Switch
                        checked={tier.is_enabled}
                        onCheckedChange={(v) =>
                          patch(tier.id, "is_enabled", v)
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-col">
                        <Text size="small">
                          {bdt(p.total)}{" "}
                          <span className="text-ui-fg-muted line-through">
                            {bdt(p.subtotal)}
                          </span>
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          save {bdt(p.discount)}
                          <Badge size="2xsmall" className="ml-1">
                            {p.applied}
                          </Badge>
                        </Text>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-x-2">
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => saveTier(tier)}
                        >
                          Save
                        </Button>
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => removeTier(tier.id, tier.quantity)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
              {!tiers.length ? (
                <Table.Row>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      No tiers yet. Add one to start showing the widget.
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ) : null}
            </Table.Body>
          </Table>
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Bundles",
  icon: Tag,
})

export default BundlesPage
