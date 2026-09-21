import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShoppingBag } from "@medusajs/icons"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"

const STATUSES = [
  "processing",
  "confirmed",
  "shipped",
  "delivered",
  "returned",
  "refunded",
  "cancelled",
] as const
type Status = (typeof STATUSES)[number]

const LABELS: Record<Status, string> = {
  processing: "Processing",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  refunded: "Refunded",
  cancelled: "Cancelled",
}
const COLORS: Record<Status, "grey" | "green" | "red" | "blue" | "orange" | "purple"> = {
  processing: "orange",
  confirmed: "blue",
  shipped: "purple",
  delivered: "green",
  returned: "red",
  refunded: "grey",
  cancelled: "grey",
}

type ManagedOrder = {
  order_id: string
  display_id: number | null
  created_at: string
  total: number
  currency_code: string
  customer_name: string
  phone: string
  address: string
  district: string
  items: string
  item_count: number
  workflow_status: Status
  steadfast_consignment_id: string | null
  steadfast_tracking_code: string | null
  steadfast_status: string | null
  label_printed_at: string | null
  note: string | null
}

const bdt = (n: number) => `৳${Math.round(n).toLocaleString("en-US")}`
const date = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? "—" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: "include", headers: { "content-type": "application/json" }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || "Request failed.")
  return data
}

const OrdersPage = () => {
  const [tab, setTab] = useState<Status>("processing")
  const [orders, setOrders] = useState<ManagedOrder[]>([])
  const [counts, setCounts] = useState<Record<Status, number>>({} as Record<Status, number>)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const load = useCallback(async (status: Status) => {
    setLoading(true)
    try {
      const data = await api(`/admin/order-ops?status=${status}&limit=100`)
      setOrders(data.orders ?? [])
      setCounts(data.counts ?? {})
      setSelected(new Set())
    } catch (e: any) {
      toast.error(e?.message || "Could not load orders.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(tab)
  }, [tab, load])

  const allSelected = orders.length > 0 && selected.size === orders.length
  const selectedIds = useMemo(() => [...selected], [selected])

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.order_id)))
  }
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e: any) {
      toast.error(e?.message || `${label} failed.`)
    } finally {
      setBusy(false)
    }
  }

  const moveTo = (status: Status) =>
    run("Status change", async () => {
      await api("/admin/order-ops/status", {
        method: "POST",
        body: JSON.stringify({ order_ids: selectedIds, status }),
      })
      toast.success(`Moved ${selectedIds.length} to ${LABELS[status]}`)
      await load(tab)
    })

  const sendToCourier = () =>
    run("Send to courier", async () => {
      const data = await api("/admin/courier/send", {
        method: "POST",
        body: JSON.stringify({ order_ids: selectedIds }),
      })
      const failed = (data.results ?? []).filter((r: any) => !r.ok)
      toast.success(`Sent ${data.sent} to Steadfast${failed.length ? `, ${failed.length} failed` : ""}`)
      if (failed.length) toast.error(failed.map((r: any) => r.error).slice(0, 3).join(" · "))
      await load(tab)
    })

  const printLabels = () => {
    if (!selectedIds.length) return
    window.open(`/admin/courier/label?order_ids=${selectedIds.join(",")}`, "_blank")
  }

  const syncCourier = () =>
    run("Sync", async () => {
      const data = await api("/admin/courier/sync", { method: "POST", body: JSON.stringify({}) })
      toast.success(`Checked ${data.checked}, ${data.changed} updated`)
      await load(tab)
    })

  const backfill = () =>
    run("Import", async () => {
      const data = await api("/admin/order-ops/backfill", { method: "POST", body: "{}" })
      toast.success(`Imported ${data.created} order${data.created === 1 ? "" : "s"}`)
      await load(tab)
    })

  return (
    <Container className="p-0 divide-y">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Heading level="h1">Orders</Heading>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="small" variant="secondary" onClick={syncCourier} disabled={busy}>
            Sync courier status
          </Button>
          <Button size="small" variant="secondary" onClick={backfill} disabled={busy}>
            Import old orders
          </Button>
          <Button size="small" variant="secondary" onClick={() => setShowSettings((s) => !s)}>
            Courier settings
          </Button>
        </div>
      </div>

      {showSettings ? <CourierSettings onClose={() => setShowSettings(false)} /> : null}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 px-6 py-3">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setTab(s)}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              tab === s ? "bg-ui-bg-base-pressed font-medium text-ui-fg-base shadow-borders-base" : "text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
            }`}
          >
            {LABELS[s]}
            <Badge size="2xsmall" color={COLORS[s]}>{counts[s] ?? 0}</Badge>
          </button>
        ))}
      </div>

      {/* Bulk toolbar */}
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 bg-ui-bg-subtle px-6 py-3">
          <Text size="small" weight="plus">{selectedIds.length} selected</Text>
          <div className="mx-1 h-4 w-px bg-ui-border-base" />
          <Button size="small" variant="primary" onClick={sendToCourier} disabled={busy}>
            Send to Steadfast
          </Button>
          <Button size="small" variant="secondary" onClick={printLabels} disabled={busy}>
            Print labels
          </Button>
          <div className="mx-1 h-4 w-px bg-ui-border-base" />
          <Text size="small" className="text-ui-fg-subtle">Move to:</Text>
          {STATUSES.filter((s) => s !== tab).map((s) => (
            <Button key={s} size="small" variant="transparent" onClick={() => moveTo(s)} disabled={busy}>
              {LABELS[s]}
            </Button>
          ))}
        </div>
      ) : null}

      {/* Table */}
      <div className="px-2 py-2">
        {loading ? (
          <div className="px-4 py-10 text-center text-ui-fg-subtle">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="px-4 py-10 text-center text-ui-fg-subtle">No orders in {LABELS[tab]}.</div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell className="w-8">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </Table.HeaderCell>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Items</Table.HeaderCell>
                <Table.HeaderCell>Total</Table.HeaderCell>
                <Table.HeaderCell>Courier</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {orders.map((o) => (
                <Table.Row key={o.order_id}>
                  <Table.Cell>
                    <Checkbox checked={selected.has(o.order_id)} onCheckedChange={() => toggle(o.order_id)} />
                  </Table.Cell>
                  <Table.Cell>
                    <div className="font-medium">#{o.display_id ?? "—"}</div>
                    <div className="text-ui-fg-subtle text-xs">{date(o.created_at)}</div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="font-medium">{o.customer_name || "—"}</div>
                    <div className="text-ui-fg-subtle text-xs">{o.phone}</div>
                    <div className="text-ui-fg-muted text-xs max-w-[240px] truncate">{o.address}</div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="max-w-[220px] truncate text-sm">{o.items}</div>
                    <div className="text-ui-fg-subtle text-xs">{o.item_count} item{o.item_count === 1 ? "" : "s"}</div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap tabular-nums">{bdt(o.total)}</Table.Cell>
                  <Table.Cell>
                    {o.steadfast_tracking_code ? (
                      <div className="text-xs">
                        <div className="font-mono">{o.steadfast_tracking_code}</div>
                        {o.steadfast_status ? (
                          <div className="text-ui-fg-subtle">{o.steadfast_status}</div>
                        ) : null}
                      </div>
                    ) : (
                      <Badge size="2xsmall" color={COLORS[o.workflow_status]}>{LABELS[o.workflow_status]}</Badge>
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

function CourierSettings({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [info, setInfo] = useState<{ api_key_masked: string; secret_key_masked: string } | null>(null)
  const [balance, setBalance] = useState<string>("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api("/admin/courier/settings")
      .then((d) => {
        setEnabled(Boolean(d.settings?.enabled))
        setInfo({ api_key_masked: d.settings?.api_key_masked ?? "", secret_key_masked: d.settings?.secret_key_masked ?? "" })
      })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { enabled }
      if (apiKey.trim()) body.api_key = apiKey.trim()
      if (secretKey.trim()) body.secret_key = secretKey.trim()
      const d = await api("/admin/courier/settings", { method: "POST", body: JSON.stringify(body) })
      setInfo({ api_key_masked: d.settings?.api_key_masked ?? "", secret_key_masked: d.settings?.secret_key_masked ?? "" })
      setApiKey("")
      setSecretKey("")
      toast.success("Courier settings saved")
    } catch (e: any) {
      toast.error(e?.message || "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  async function checkBalance() {
    try {
      const d = await api("/admin/courier/balance")
      setBalance(`৳${Number(d.balance ?? 0).toLocaleString("en-US")}`)
    } catch (e: any) {
      toast.error(e?.message || "Could not fetch balance.")
    }
  }

  return (
    <div className="bg-ui-bg-subtle px-6 py-5">
      <div className="flex items-center justify-between">
        <Heading level="h2">Steadfast courier</Heading>
        <Button size="small" variant="transparent" onClick={onClose}>Close</Button>
      </div>
      <div className="mt-3 grid max-w-xl gap-3">
        <div className="grid gap-1.5">
          <Label size="small">Api-Key {info?.api_key_masked ? <span className="text-ui-fg-muted">(saved {info.api_key_masked})</span> : null}</Label>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste to update" autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <Label size="small">Secret-Key {info?.secret_key_masked ? <span className="text-ui-fg-muted">(saved {info.secret_key_masked})</span> : null}</Label>
          <Input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="Paste to update" autoComplete="off" />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label size="small">Enable courier actions</Label>
        </div>
        <div className="flex items-center gap-2">
          <Button size="small" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button size="small" variant="secondary" onClick={checkBalance}>Check balance</Button>
          {balance ? <Text size="small">Balance: {balance}</Text> : null}
        </div>
        <Text size="xsmall" className="text-ui-fg-muted">
          Keys are stored in the database and never shown again in full. Get them from the Steadfast merchant portal → API.
        </Text>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Order Manager",
  icon: ShoppingBag,
})

export default OrdersPage
