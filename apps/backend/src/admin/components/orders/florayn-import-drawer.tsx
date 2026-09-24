import { Badge, Button, Drawer, Input, Label, Text, toast } from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"

type Progress = {
  total: number; seen: number; created: number; rebuilt?: number; updated: number; unchanged: number; skipped: number; failed: number
  adjusted?: number; linked?: number; lines?: number; mismatched?: number; errors: { id: string; message: string }[]
}
type ImportInfo = {
  site_url: string
  consumer_key_masked: string
  consumer_secret_set: boolean
  ready: boolean
  state: "idle" | "running" | "done" | "failed"
  progress: Progress | null
  started_at: string | null
  finished_at: string | null
  last_error: string | null
  /** Imported orders an older version of the import made; the next run rebuilds them. */
  outdated?: number
}
type Preview = {
  total: number
  imported: number
  orders: { number: string; date?: string; status: string; becomes?: string; name?: string; phone?: string | null; email?: string | null; district?: string; items?: { title: string; quantity: number; price: number; options: string | null; linked: boolean }[]; delivery?: number; total?: number; advance?: number; adjusted?: boolean; payment?: string | null; skipped?: boolean }[]
}

async function call(path: string, body?: unknown) {
  const res = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "include", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data?.message || "Request failed."), { errors: data?.errors })
  return data
}

const taka = (n: number) => `৳${Math.round(n).toLocaleString("en-US")}`

/**
 * Order Manager > Import from florayn.com: paste a read-only WooCommerce key,
 * preview the newest orders as they would come in, then import them all. It
 * runs on the server; this polls the progress. Running it again later adds
 * new florayn.com orders and moves changed statuses.
 */
export function FloraynImportDrawer({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [info, setInfo] = useState<ImportInfo | null>(null)
  const [form, setForm] = useState({ site_url: "", consumer_key: "", consumer_secret: "" })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState("")
  const wasRunning = useRef(false)

  const load = useCallback(async () => {
    const data = await call("/admin/florayn-import")
    setInfo(data.import)
    return data.import as ImportInfo
  }, [])
  useEffect(() => { void load().then((i) => setForm((f) => ({ ...f, site_url: i.site_url }))).catch((e) => toast.error(e.message)) }, [load])

  // Poll while a run is going; refresh the order list when it ends.
  useEffect(() => {
    if (info?.state !== "running") {
      if (wasRunning.current) { wasRunning.current = false; onImported() }
      return
    }
    wasRunning.current = true
    const timer = setInterval(() => { void load().catch(() => undefined) }, 2000)
    return () => clearInterval(timer)
  }, [info?.state, load, onImported])

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try { await fn() } catch (e: any) { setErrors(e.errors ?? {}); toast.error(e.message) } finally { setBusy("") }
  }
  const save = () => run("save", async () => {
    setErrors({})
    const data = await call("/admin/florayn-import", { action: "save", ...form })
    setInfo(data.import); setForm((f) => ({ ...f, consumer_key: "", consumer_secret: "" }))
    toast.success("Key saved.")
  })
  const doPreview = () => run("preview", async () => { setPreview(await call("/admin/florayn-import", { action: "preview" })) })
  const start = () => run("run", async () => {
    const data = await call("/admin/florayn-import", { action: "run" })
    setInfo(data.import)
  })

  const p = info?.progress
  const running = info?.state === "running"
  return (
    <Drawer open onOpenChange={(open) => { if (!open) onClose() }}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header><Drawer.Title>Import from florayn.com</Drawer.Title></Drawer.Header>
        <Drawer.Body className="flex flex-col gap-5 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle">
            Brings every florayn.com order, with its customer, into this store so they are listed here and under Customers. florayn.com is only read. Imported orders keep their florayn.com date, number and status, are marked “florayn.com”, and are never sent to Steadfast or asked for a review from here. Running it again later adds new orders and updates statuses; nothing is duplicated.
          </Text>

          <section className="grid gap-3">
            <Text weight="plus">1. A read-only key</Text>
            <ol className="grid list-decimal gap-1 pl-5 text-sm text-ui-fg-subtle">
              <li>On florayn.com's WordPress admin: WooCommerce &gt; Settings &gt; Advanced &gt; REST API &gt; Add key.</li>
              <li>Description “New store import”, your admin user, Permissions <strong>Read</strong>, then Generate API key.</li>
              <li>Paste the Consumer key and Consumer secret here. You can revoke the key there once the move is done.</li>
            </ol>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1 md:col-span-2"><Label size="small">Shop address</Label><Input value={form.site_url} onChange={(e) => setForm({ ...form, site_url: e.target.value })} />{errors.site_url ? <Text size="xsmall" className="text-ui-fg-error">{errors.site_url}</Text> : null}</div>
              {/* Not a login: "one-time-code" and no password field keep the
                  browser from filling a saved email and password in here. */}
              <div className="grid gap-1"><Label size="small">Consumer key {info?.consumer_key_masked ? <span className="text-ui-fg-muted">(saved {info.consumer_key_masked})</span> : null}</Label><Input name="wc-consumer-key" value={form.consumer_key} placeholder="ck_…" autoComplete="one-time-code" spellCheck={false} data-1p-ignore data-lpignore="true" onChange={(e) => setForm({ ...form, consumer_key: e.target.value })} />{errors.consumer_key ? <Text size="xsmall" className="text-ui-fg-error">{errors.consumer_key}</Text> : null}</div>
              <div className="grid gap-1"><Label size="small">Consumer secret {info?.consumer_secret_set ? <span className="text-ui-fg-muted">(saved)</span> : null}</Label><Input name="wc-consumer-secret" value={form.consumer_secret} placeholder="cs_…" autoComplete="one-time-code" spellCheck={false} data-1p-ignore data-lpignore="true" style={{ WebkitTextSecurity: "disc" } as React.CSSProperties} onChange={(e) => setForm({ ...form, consumer_secret: e.target.value })} />{errors.consumer_secret ? <Text size="xsmall" className="text-ui-fg-error">{errors.consumer_secret}</Text> : null}</div>
            </div>
            <div><Button size="small" onClick={save} isLoading={busy === "save"}>Save key</Button></div>
          </section>

          <section className="grid gap-3">
            <Text weight="plus">2. Check a few</Text>
            <div><Button size="small" variant="secondary" onClick={doPreview} isLoading={busy === "preview"} disabled={!info?.ready}>Preview the newest 5</Button></div>
            {preview ? <div className="grid gap-2">
              <Text size="small">florayn.com has <strong>{preview.total}</strong> orders; {preview.imported} already imported.</Text>
              {preview.orders.map((o) => <div key={o.number} className="grid gap-1 rounded-lg border p-3 text-sm">
                {o.skipped ? <Text size="small">#{o.number} · {o.status} · not imported (draft)</Text> : <>
                  <div className="flex flex-wrap items-center gap-2"><strong>#{o.number}</strong><span className="text-ui-fg-muted">{o.date ? new Date(o.date).toLocaleString() : ""}</span><Badge size="2xsmall">{o.status} → {o.becomes}</Badge>{o.adjusted ? <Badge size="2xsmall" color="orange">price adjusted</Badge> : null}</div>
                  <div>{o.name || "—"} · {o.phone || "no phone"} · {o.email || "no email"}{o.district ? ` · ${o.district}` : ""}</div>
                  {(o.items ?? []).map((i, n) => <div key={n} className="text-ui-fg-subtle">{i.quantity} × {i.title}{i.options ? ` (${i.options})` : ""} · {taka(i.price)}{i.linked ? "" : " · not linked to a product here"}</div>)}
                  <div className="text-ui-fg-subtle">Delivery {taka(o.delivery ?? 0)} · Paid {taka(o.total ?? 0)}{o.advance ? ` (${taka(o.advance)} in advance)` : ""}{o.payment ? ` · ${o.payment}` : ""}</div>
                </>}
              </div>)}
            </div> : null}
          </section>

          <section className="grid gap-3">
            <Text weight="plus">3. Import</Text>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="small" onClick={start} isLoading={busy === "run"} disabled={!info?.ready || running}>{info?.outdated ? "Rebuild and import again" : info?.finished_at ? "Import again (new orders and status changes)" : "Import all orders"}</Button>
              {info ? <Badge color={running ? "orange" : info.state === "done" ? "green" : info.state === "failed" ? "red" : "grey"}>{running ? "Importing…" : info.state}</Badge> : null}
            </div>
            {info?.outdated && !running ? <Text size="small" className="rounded-md bg-ui-bg-subtle p-2">
              {info.outdated} imported orders were made by the first version of the import. Run it again to rebuild them under the same order numbers: totals become what the customer actually paid (bKash advance + cash on delivery) and items link to the products in this store.
            </Text> : null}
            {p ? <div className="grid gap-1 text-sm">
              <Text size="small">{p.seen} of {p.total || "?"} read · <strong>{p.created}</strong> added{p.rebuilt ? <> · <strong>{p.rebuilt}</strong> rebuilt</> : null} · {p.updated} status updated · {p.unchanged} unchanged · {p.skipped} drafts skipped{p.failed ? <span className="text-ui-fg-error"> · {p.failed} failed</span> : null}{p.adjusted ? ` · ${p.adjusted} with the price adjusted to what was paid` : p.mismatched ? ` · ${p.mismatched} with a different total` : ""}{p.lines ? ` · ${p.linked}/${p.lines} items linked to products` : ""}</Text>
              {p.total ? <div className="h-2 overflow-hidden rounded-full bg-ui-bg-component"><div className="h-full bg-ui-fg-interactive transition-all" style={{ width: `${Math.min(100, Math.round((p.seen / p.total) * 100))}%` }} /></div> : null}
              {p.errors.length ? <details><summary className="cursor-pointer text-ui-fg-error">Orders that failed</summary><ul className="mt-1 grid gap-0.5">{p.errors.map((e) => <li key={e.id} className="text-xs">#{e.id}: {e.message}</li>)}</ul></details> : null}
            </div> : null}
            {info?.last_error ? <Text size="small" className="text-ui-fg-error">{info.last_error}</Text> : null}
            {info?.finished_at && !running ? <Text size="xsmall" className="text-ui-fg-muted">Last run finished {new Date(info.finished_at).toLocaleString()}.</Text> : null}
          </section>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}
