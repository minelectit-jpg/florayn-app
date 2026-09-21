import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShoppingBag } from "@medusajs/icons"
import {
  Badge,
  Button,
  Checkbox,
  Copy,
  Drawer,
  Heading,
  IconButton,
  Input,
  Label,
  StatusBadge,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"

type Tab = "all" | Status
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
const TABS: Tab[] = ["all", ...STATUSES]

const LABELS: Record<Tab, string> = {
  all: "All",
  processing: "Processing",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  refunded: "Refunded",
  cancelled: "Cancelled",
}
type BadgeColor = "grey" | "green" | "red" | "blue" | "orange" | "purple"
const COLORS: Record<Status, BadgeColor> = {
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
}

const PAGE = 30
const bdt = (n: number) => `৳${Math.round(n).toLocaleString("en-US")}`
const fmtDate = (iso: string) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return { d: "—", t: "" }
  const dt = new Date(t)
  return {
    d: dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    t: dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  }
}
const prettyRaw = (s: string | null) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : ""

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: "include", headers: { "content-type": "application/json" }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || "Request failed.")
  return data
}

const OrderManagerPage = () => {
  const [tab, setTab] = useState<Tab>("all")
  const [orders, setOrders] = useState<ManagedOrder[]>([])
  const [counts, setCounts] = useState<Record<Status, number>>({} as Record<Status, number>)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const load = useCallback(async (t: Tab, off: number) => {
    setLoading(true)
    try {
      const data = await api(`/admin/order-ops?status=${t}&limit=${PAGE}&offset=${off}`)
      setOrders(data.orders ?? [])
      setCounts(data.counts ?? {})
      setTotal(data.count ?? 0)
      setSelected(new Set())
    } catch (e: any) {
      toast.error(e?.message || "Could not load orders.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(tab, offset)
  }, [tab, offset, load])

  const allCount = useMemo(() => STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0), [counts])
  const tabCount = (t: Tab) => (t === "all" ? allCount : counts[t as Status] ?? 0)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter((o) =>
      [String(o.display_id ?? ""), o.customer_name, o.phone, o.steadfast_tracking_code, o.steadfast_consignment_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [orders, search])

  const selectedIds = useMemo(() => [...selected], [selected])
  const allSelected = visible.length > 0 && visible.every((o) => selected.has(o.order_id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((o) => o.order_id)))
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

  const moveTo = (ids: string[], status: Status) =>
    run("Status change", async () => {
      await api("/admin/order-ops/status", { method: "POST", body: JSON.stringify({ order_ids: ids, status }) })
      toast.success(`Moved ${ids.length} to ${LABELS[status]}`)
      await load(tab, offset)
    })

  const sendToCourier = (ids: string[]) =>
    run("Send to courier", async () => {
      const data = await api("/admin/courier/send", { method: "POST", body: JSON.stringify({ order_ids: ids }) })
      const failed = (data.results ?? []).filter((r: any) => !r.ok)
      toast.success(`Sent ${data.sent} to Steadfast${failed.length ? `, ${failed.length} failed` : ""}`)
      if (failed.length) toast.error(failed.map((r: any) => r.error).slice(0, 3).join(" · "))
      await load(tab, offset)
    })

  const printLabels = (ids: string[]) => {
    if (ids.length) window.open(`/admin/courier/label?order_ids=${ids.join(",")}`, "_blank")
  }

  const syncCourier = (ids?: string[]) =>
    run("Sync", async () => {
      const data = await api("/admin/courier/sync", { method: "POST", body: JSON.stringify(ids ? { order_ids: ids } : {}) })
      toast.success(`Checked ${data.checked}, ${data.changed} updated`)
      await load(tab, offset)
    })

  const backfill = () =>
    run("Import", async () => {
      const data = await api("/admin/order-ops/backfill", { method: "POST", body: "{}" })
      toast.success(`Imported ${data.created} order${data.created === 1 ? "" : "s"}`)
      await load(tab, offset)
    })

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading level="h1">Order Manager</Heading>
          <Text size="small" className="text-ui-fg-subtle">Every order and courier parcel, by status.</Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CourierBalance />
          <Button size="small" variant="secondary" onClick={() => syncCourier()} disabled={busy}>Sync status</Button>
          <Button size="small" variant="secondary" onClick={backfill} disabled={busy}>Import old orders</Button>
          <Button size="small" variant="secondary" onClick={() => setShowSettings(true)}>Courier settings</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setOffset(0) }}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                active
                  ? "border-ui-fg-base bg-ui-bg-base text-ui-fg-base shadow-elevation-card-rest"
                  : "border-ui-border-base bg-ui-bg-subtle text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
              }`}
            >
              {LABELS[t]}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-ui-bg-component text-ui-fg-base" : "text-ui-fg-muted"}`}>
                {tabCount(t)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Card */}
      <div className="overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base shadow-elevation-card-rest">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ui-border-base px-4 py-3">
          <Input
            size="small"
            placeholder="Search order #, name, phone, tracking…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <div className="grow" />
          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Text size="small" weight="plus">{selectedIds.length} selected</Text>
              <Button size="small" variant="primary" onClick={() => sendToCourier(selectedIds)} disabled={busy}>Send to Steadfast</Button>
              <Button size="small" variant="secondary" onClick={() => printLabels(selectedIds)} disabled={busy}>Print labels</Button>
              <StatusMenu onPick={(s) => moveTo(selectedIds, s)} exclude={tab === "all" ? undefined : (tab as Status)} disabled={busy} />
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-muted">{total} order{total === 1 ? "" : "s"}</Text>
          )}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-16 text-center text-ui-fg-subtle">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-16 text-center text-ui-fg-subtle">
            {tab === "all" && total === 0 ? (
              <div className="space-y-3">
                <p>No orders yet. Import your existing orders to get started.</p>
                <Button size="small" variant="secondary" onClick={backfill}>Import old orders</Button>
              </div>
            ) : (
              <p>No orders in {LABELS[tab]}{search ? " matching your search" : ""}.</p>
            )}
          </div>
        ) : (
          <div>
            {/* Column header */}
            <div className="hidden grid-cols-[28px_120px_1fr_130px_90px_130px_28px] items-center gap-3 border-b border-ui-border-base px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ui-fg-muted md:grid">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              <span>Order</span>
              <span>Recipient</span>
              <span>Date</span>
              <span className="text-right">COD</span>
              <span>Status</span>
              <span />
            </div>
            <ul className="divide-y divide-ui-border-base">
              {visible.map((o) => {
                const date = fmtDate(o.created_at)
                return (
                  <li
                    key={o.order_id}
                    className="grid cursor-pointer grid-cols-[28px_1fr_28px] items-center gap-3 px-4 py-3 transition-colors hover:bg-ui-bg-base-hover md:grid-cols-[28px_120px_1fr_130px_90px_130px_28px]"
                    onClick={() => setDetailId(o.order_id)}
                  >
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(o.order_id)} onCheckedChange={() => toggle(o.order_id)} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-ui-fg-base">#{o.display_id ?? "—"}</div>
                      {o.steadfast_tracking_code ? (
                        <div className="flex items-center gap-1 text-xs text-ui-fg-subtle" onClick={(e) => e.stopPropagation()}>
                          <span className="font-mono">{o.steadfast_tracking_code}</span>
                          <Copy content={o.steadfast_tracking_code} className="text-ui-fg-muted" />
                        </div>
                      ) : (
                        <div className="text-xs text-ui-fg-muted">Not sent</div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ui-fg-base">{o.customer_name || "—"}</div>
                      <div className="truncate text-xs text-ui-fg-subtle">{o.phone}{o.district ? ` · ${o.district}` : ""}</div>
                    </div>
                    <div className="hidden md:block">
                      <div className="text-sm text-ui-fg-base">{date.d}</div>
                      <div className="text-xs text-ui-fg-muted">{date.t}</div>
                    </div>
                    <div className="hidden text-right font-medium tabular-nums text-ui-fg-base md:block">{bdt(o.total)}</div>
                    <div className="hidden md:block">
                      <StatusBadge color={COLORS[o.workflow_status]}>{LABELS[o.workflow_status]}</StatusBadge>
                      {o.steadfast_status && o.workflow_status === "shipped" ? (
                        <div className="mt-0.5 text-[11px] text-ui-fg-muted">{prettyRaw(o.steadfast_status)}</div>
                      ) : null}
                    </div>
                    <ChevronRight />
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE ? (
          <div className="flex items-center justify-between border-t border-ui-border-base px-4 py-3">
            <Text size="small" className="text-ui-fg-muted">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </Text>
            <div className="flex gap-2">
              <Button size="small" variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</Button>
              <Button size="small" variant="secondary" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>Next</Button>
            </div>
          </div>
        ) : null}
      </div>

      {showSettings ? <CourierSettingsDrawer onClose={() => setShowSettings(false)} /> : null}
      {detailId ? (
        <OrderDetailDrawer
          orderId={detailId}
          onClose={() => setDetailId(null)}
          busy={busy}
          onSend={(id) => sendToCourier([id])}
          onLabel={(id) => printLabels([id])}
          onSync={(id) => syncCourier([id])}
          onMove={(id, s) => moveTo([id], s)}
        />
      ) : null}
    </div>
  )
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="justify-self-end text-ui-fg-muted">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatusMenu({ onPick, exclude, disabled }: { onPick: (s: Status) => void; exclude?: Status; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="small" variant="secondary" onClick={() => setOpen((o) => !o)} disabled={disabled}>Move to ▾</Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout">
            {STATUSES.filter((s) => s !== exclude).map((s) => (
              <button
                key={s}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-ui-fg-base hover:bg-ui-bg-base-hover"
                onClick={() => { setOpen(false); onPick(s) }}
              >
                {LABELS[s]}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function CourierBalance() {
  const [balance, setBalance] = useState<string | null>(null)
  const check = async () => {
    try {
      const d = await api("/admin/courier/balance")
      setBalance(`৳${Number(d.balance ?? 0).toLocaleString("en-US")}`)
    } catch {
      setBalance(null)
      toast.error("Courier not configured yet.")
    }
  }
  return (
    <button
      type="button"
      onClick={check}
      className="rounded-full border border-ui-border-base bg-ui-bg-subtle px-3 py-1.5 text-sm text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
    >
      {balance ? `Balance ${balance}` : "Check balance"}
    </button>
  )
}

type OrderDetail = {
  order_id: string
  display_id: number | null
  created_at: string
  total: number
  subtotal: number
  shipping_total: number
  note: string | null
  customer_name: string
  phone: string
  address_1: string
  area: string
  district: string
  items: { title: string; variant_title: string | null; quantity: number; unit_price: number; thumbnail: string | null }[]
  workflow_status: Status
  steadfast_consignment_id: string | null
  steadfast_tracking_code: string | null
  steadfast_status: string | null
  steadfast_synced_at: string | null
  label_printed_at: string | null
}

function OrderDetailDrawer({
  orderId,
  onClose,
  busy,
  onSend,
  onLabel,
  onSync,
  onMove,
}: {
  orderId: string
  onClose: () => void
  busy: boolean
  onSend: (id: string) => void
  onLabel: (id: string) => void
  onSync: (id: string) => void
  onMove: (id: string, s: Status) => void
}) {
  const [d, setD] = useState<OrderDetail | null>(null)
  useEffect(() => {
    api(`/admin/order-ops/${orderId}`).then((r) => setD(r.order)).catch(() => setD(null))
  }, [orderId])

  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose() }}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Order #{d?.display_id ?? "…"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto">
          {!d ? (
            <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <StatusBadge color={COLORS[d.workflow_status]}>{LABELS[d.workflow_status]}</StatusBadge>
                {d.steadfast_status ? <Badge size="2xsmall">{prettyRaw(d.steadfast_status)}</Badge> : null}
              </div>

              {/* Courier */}
              {d.steadfast_tracking_code ? (
                <Section title="Courier">
                  <Row k="Tracking"><span className="font-mono">{d.steadfast_tracking_code}</span> <Copy content={d.steadfast_tracking_code} /></Row>
                  {d.steadfast_consignment_id ? <Row k="Consignment">{d.steadfast_consignment_id}</Row> : null}
                  {d.steadfast_synced_at ? <Row k="Last synced">{fmtDate(d.steadfast_synced_at).d} {fmtDate(d.steadfast_synced_at).t}</Row> : null}
                </Section>
              ) : null}

              {/* Recipient */}
              <Section title="Deliver to">
                <div className="text-sm">
                  <div className="font-medium text-ui-fg-base">{d.customer_name || "—"}</div>
                  <div className="text-ui-fg-subtle">{d.phone}</div>
                  <div className="text-ui-fg-subtle">{[d.address_1, d.area, d.district].filter(Boolean).join(", ")}</div>
                </div>
              </Section>

              {/* Items */}
              <Section title={`Items (${d.items.reduce((n, i) => n + i.quantity, 0)})`}>
                <ul className="flex flex-col gap-2">
                  {d.items.map((i, idx) => (
                    <li key={idx} className="flex items-center gap-3">
                      <span className="size-10 shrink-0 overflow-hidden rounded-md bg-ui-bg-subtle">
                        {i.thumbnail ? <img src={i.thumbnail} alt="" className="size-full object-cover" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ui-fg-base">{i.title}</span>
                        {i.variant_title ? <span className="block truncate text-xs text-ui-fg-subtle">{i.variant_title}</span> : null}
                      </span>
                      <span className="text-sm text-ui-fg-subtle">×{i.quantity}</span>
                      <span className="w-16 text-right text-sm tabular-nums text-ui-fg-base">{bdt(i.unit_price)}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              {/* Totals */}
              <Section title="Payment (Cash on Delivery)">
                <Row k="Subtotal">{bdt(d.subtotal)}</Row>
                <Row k="Shipping">{d.shipping_total === 0 ? "Free" : bdt(d.shipping_total)}</Row>
                <Row k="Total (COD)"><b>{bdt(d.total)}</b></Row>
              </Section>

              {d.note ? <Section title="Order note"><Text size="small" className="text-ui-fg-subtle">{d.note}</Text></Section> : null}
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          {d ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              {d.steadfast_tracking_code ? (
                <>
                  <Button size="small" variant="secondary" onClick={() => onLabel(d.order_id)}>Print label</Button>
                  <Button size="small" variant="secondary" onClick={() => onSync(d.order_id)} disabled={busy}>Sync status</Button>
                </>
              ) : (
                <Button size="small" variant="primary" onClick={() => onSend(d.order_id)} disabled={busy}>Send to Steadfast</Button>
              )}
              <div className="grow" />
              <StatusMenu onPick={(s) => onMove(d.order_id, s)} exclude={d.workflow_status} disabled={busy} />
            </div>
          ) : null}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="xsmall" weight="plus" className="mb-1.5 uppercase tracking-wide text-ui-fg-muted">{title}</Text>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ui-fg-subtle">{k}</span>
      <span className="flex items-center gap-1.5 text-ui-fg-base">{children}</span>
    </div>
  )
}

function CourierSettingsDrawer({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [info, setInfo] = useState<{ api_key_masked: string; secret_key_masked: string } | null>(null)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookToken, setWebhookToken] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api("/admin/courier/settings").then((d) => {
      setEnabled(Boolean(d.settings?.enabled))
      setInfo({ api_key_masked: d.settings?.api_key_masked ?? "", secret_key_masked: d.settings?.secret_key_masked ?? "" })
      setWebhookUrl(`${window.location.origin}${d.settings?.webhook_path ?? "/webhooks/steadfast"}`)
      setWebhookToken(d.settings?.webhook_token ?? "")
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { enabled }
      if (apiKey.trim()) body.api_key = apiKey.trim()
      if (secretKey.trim()) body.secret_key = secretKey.trim()
      if (webhookToken.trim()) body.webhook_token = webhookToken.trim()
      const d = await api("/admin/courier/settings", { method: "POST", body: JSON.stringify(body) })
      setInfo({ api_key_masked: d.settings?.api_key_masked ?? "", secret_key_masked: d.settings?.secret_key_masked ?? "" })
      setApiKey(""); setSecretKey("")
      toast.success("Courier settings saved")
    } catch (e: any) {
      toast.error(e?.message || "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose() }}>
      <Drawer.Content>
        <Drawer.Header><Drawer.Title>Steadfast courier</Drawer.Title></Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4">
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
          <Text size="xsmall" className="text-ui-fg-muted">
            Keys are stored in the database and never shown again in full. Get them from the Steadfast merchant portal → API.
          </Text>

          <div className="mt-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
            <Text size="small" weight="plus">Auto-update statuses (webhook)</Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              In the Steadfast portal → API → Webhook, set the Callback URL below and use the same Auth token on both sides (paste this one into Steadfast, or paste Steadfast’s token here and Save). Delivered / returned statuses then update here automatically.
            </Text>
            <div className="mt-2 grid gap-2">
              <div className="grid gap-1">
                <Label size="small">Callback URL</Label>
                <div className="flex items-center gap-1.5 rounded-md border border-ui-border-base bg-ui-bg-base px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ui-fg-base">{webhookUrl}</span>
                  <Copy content={webhookUrl} />
                </div>
              </div>
              <div className="grid gap-1">
                <Label size="small">Auth token</Label>
                <div className="flex items-center gap-1.5">
                  <Input value={webhookToken} onChange={(e) => setWebhookToken(e.target.value)} className="font-mono text-xs" placeholder="Shared webhook token" />
                  <Copy content={webhookToken} />
                </div>
              </div>
            </div>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button size="small" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const config = defineRouteConfig({
  label: "Order Manager",
  icon: ShoppingBag,
})

export default OrderManagerPage
