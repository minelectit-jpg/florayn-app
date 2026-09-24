import { Badge, Button, Container, Heading, Input, Label, Switch, Text, toast } from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, post, ManagerSelect } from "../product-manager/shared"

export type ReviewProgram = {
  requests: { enabled: boolean; delay_days: number; statuses: string[]; batch: number; max_age_days: number; started_at: string | null }
  rewards: { enabled: boolean; photo_pct: number; text_pct: number; expiry_days: number; cooldown_days: number; max_photos: number; min_rating: number }
  auto_approve: boolean
  from_name: string
}
type Stats = { queue: number; sent: number; coupons: number; approved: number; pending: number }

const STATUSES = ["processing", "confirmed", "shipped", "delivered", "returned", "refunded", "cancelled"]

/** Load and save the programme; both settings tabs share one copy. */
export function useReviewProgram() {
  const [settings, setSettings] = useState<ReviewProgram | null>(null)
  const [saved, setSaved] = useState<ReviewProgram | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [emailReady, setEmailReady] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const r = await api("/admin/review-program")
    setSettings(r.settings); setSaved(r.settings); setStats(r.stats); setEmailReady(r.email_configured)
  }, [])
  useEffect(() => { void load().catch((e) => toast.error(e.message)) }, [load])
  async function save() {
    if (!settings) return
    setBusy(true); setErrors({})
    try { const r = await post("/admin/review-program", { settings }); setSettings(r.settings); setSaved(r.settings); toast.success("Review settings saved."); void load() }
    catch (e: any) { toast.error(e.message) }
    finally { setBusy(false) }
  }
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved)
  return { settings, setSettings, stats, emailReady, errors, busy, save, dirty, reload: load }
}

function NumberField({ label, value, onChange, suffix, help, min, max }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; help?: string; min: number; max: number }) {
  return <div className="grid gap-1">
    <Label size="small">{label}</Label>
    <div className="flex items-center gap-2"><Input type="number" min={min} max={max} step={1} value={String(value)} onChange={(e) => onChange(Number(e.target.value))} className="max-w-28" />{suffix ? <Text size="small">{suffix}</Text> : null}</div>
    {help ? <Text size="xsmall" className="text-ui-fg-muted">{help}</Text> : null}
  </div>
}

function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-start gap-3">
    <Switch checked={checked} onCheckedChange={onChange} />
    <span><Text size="small" weight="plus">{label}</Text>{help ? <Text size="xsmall" className="text-ui-fg-muted">{help}</Text> : null}</span>
  </label>
}

type Program = ReturnType<typeof useReviewProgram>

/** "Coupon rewards": what a review earns, and when it goes live. */
export function RewardsTab({ program }: { program: Program }) {
  const { settings, setSettings, stats, busy, save, dirty } = program
  const [rewards, setRewards] = useState<any[]>([])
  useEffect(() => { void api("/admin/review-rewards").then((r) => setRewards(r.rewards)).catch(() => undefined) }, [])
  if (!settings) return <Container><Text>Loading…</Text></Container>
  const w = settings.rewards
  const setW = (patch: Partial<ReviewProgram["rewards"]>) => setSettings({ ...settings, rewards: { ...w, ...patch } })
  return <div className="grid gap-3">
    <Container className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3"><Heading level="h2">Review Rewards</Heading><Badge color={w.enabled ? "green" : "grey"}>{w.enabled ? "Active" : "Paused"}</Badge></div>
      <Text size="small" className="text-ui-fg-subtle">A published review earns a single-use percentage code, mailed to the customer. Reviews with photos earn the higher rate.</Text>
      {stats ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Codes issued", stats.coupons], ["Published reviews", stats.approved], ["Waiting for approval", stats.pending], ["Photo review reward", `${w.photo_pct}%`]].map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3"><Text size="xsmall" className="text-ui-fg-muted">{label}</Text><Text weight="plus" className="text-xl">{value}</Text></div>)}
      </div> : null}
    </Container>
    <Container className="grid gap-4">
      <div><Heading level="h3">Rewards</Heading><Text size="small" className="text-ui-fg-subtle">What a customer earns for leaving a review.</Text></div>
      <Toggle label="Give codes for published reviews" help="Turn off to keep collecting reviews without issuing codes." checked={w.enabled} onChange={(v) => setW({ enabled: v })} />
      <div className="grid gap-4 md:grid-cols-3">
        <NumberField label="Review with photos" suffix="% off" value={w.photo_pct} min={0} max={90} onChange={(n) => setW({ photo_pct: n })} />
        <NumberField label="Text only review" suffix="% off" value={w.text_pct} min={0} max={90} onChange={(n) => setW({ text_pct: n })} />
        <NumberField label="Code valid for" suffix="days" help="0 = never expires" value={w.expiry_days} min={0} max={3650} onChange={(n) => setW({ expiry_days: n })} />
        <NumberField label="One code per email every" suffix="days" help="0 = no limit" value={w.cooldown_days} min={0} max={3650} onChange={(n) => setW({ cooldown_days: n })} />
        <NumberField label="Photos per review" value={w.max_photos} min={1} max={6} onChange={(n) => setW({ max_photos: n })} />
        <NumberField label="Minimum rating to earn" suffix="stars" value={w.min_rating} min={1} max={5} onChange={(n) => setW({ min_rating: n })} />
      </div>
    </Container>
    <Container className="grid gap-4">
      <div><Heading level="h3">Moderation</Heading><Text size="small" className="text-ui-fg-subtle">When a review goes live and its code is created.</Text></div>
      <div className="grid gap-1 md:max-w-md"><Label size="small">Review approval</Label>
        <ManagerSelect aria-label="Review approval" value={settings.auto_approve ? "auto" : "manual"} onValueChange={(v) => setSettings({ ...settings, auto_approve: v === "auto" })}>
          <option value="manual">Hold every review for my approval</option>
          <option value="auto">Publish reviews immediately</option>
        </ManagerSelect>
        <Text size="xsmall" className="text-ui-fg-muted">On manual approval the code is only created and mailed once you publish the review.</Text>
      </div>
      <div className="grid gap-1 md:max-w-md"><Label size="small">Email sender name</Label><Input value={settings.from_name} maxLength={60} onChange={(e) => setSettings({ ...settings, from_name: e.target.value })} /><Text size="xsmall" className="text-ui-fg-muted">Used on the review request emails too.</Text></div>
      <div><Button onClick={save} isLoading={busy} disabled={!dirty}>Save settings</Button></div>
    </Container>
    <Container className="grid gap-3">
      <div><Heading level="h3">Recent codes</Heading><Text size="small" className="text-ui-fg-subtle">The last 50 codes issued for reviews.</Text></div>
      {rewards.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-ui-fg-muted"><th className="py-2 pr-3">Date</th><th className="pr-3">Customer</th><th className="pr-3">Product</th><th className="pr-3">Code</th><th>Photos</th></tr></thead><tbody>
        {rewards.map((r) => <tr key={r.id} className="border-t"><td className="py-2 pr-3">{new Date(r.issued_at).toLocaleDateString()}</td><td className="pr-3">{r.author}<div className="text-xs text-ui-fg-muted">{r.email}</div></td><td className="pr-3">{r.product}</td><td className="pr-3"><strong>{r.code}</strong> · {r.pct}%{r.mailed ? "" : <div className="text-xs text-ui-fg-error">not mailed</div>}</td><td>{r.photos || "—"}</td></tr>)}
      </tbody></table></div> : <Text size="small">No codes issued yet.</Text>}
    </Container>
  </div>
}

/** "Request emails": who is asked for a review, when, and the log. */
export function RequestsTab({ program }: { program: Program }) {
  const { settings, setSettings, stats, emailReady, busy, save, dirty, reload } = program
  const [queue, setQueue] = useState<{ count: number; queue: any[] } | null>(null)
  const [log, setLog] = useState<{ count: number; log: any[]; offset: number } | null>(null)
  const [q, setQ] = useState("")
  const [found, setFound] = useState<any[] | null>(null)
  const [working, setWorking] = useState("")
  const [copied, setCopied] = useState("")
  const lock = useRef(false)
  const loadLists = useCallback(async (offset = 0) => {
    const [queueResult, logResult] = await Promise.all([api("/admin/review-requests"), api(`/admin/review-requests?view=log&offset=${offset}`)])
    setQueue(queueResult); setLog(logResult)
  }, [])
  useEffect(() => { void loadLists().catch((e) => toast.error(e.message)) }, [loadLists])
  async function act(key: string, fn: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setWorking(key)
    try { await fn() } catch (e: any) { toast.error(e.message) } finally { lock.current = false; setWorking("") }
  }
  const sendOne = (orderId: string) => act(orderId, async () => {
    await post("/admin/review-requests", { action: "send", order_id: orderId })
    toast.success("Request sent.")
    await Promise.all([loadLists(), reload()])
    if (q.trim()) setFound((await api(`/admin/review-requests?q=${encodeURIComponent(q.trim())}`)).orders)
  })
  const runBatch = () => act("run", async () => {
    const r = await post("/admin/review-requests", { action: "run" })
    toast.success(`${r.sent} emails sent${r.failed ? `, ${r.failed} not sent` : ""}.`)
    await Promise.all([loadLists(), reload()])
  })
  const search = () => act("search", async () => { setFound((await api(`/admin/review-requests?q=${encodeURIComponent(q.trim())}`)).orders) })
  const copy = (link: string) => { void navigator.clipboard?.writeText(link); setCopied(link); setTimeout(() => setCopied(""), 1500) }

  if (!settings) return <Container><Text>Loading…</Text></Container>
  const r = settings.requests
  const setR = (patch: Partial<ReviewProgram["requests"]>) => setSettings({ ...settings, requests: { ...r, ...patch } })
  const toggleStatus = (status: string) => setR({ statuses: r.statuses.includes(status) ? r.statuses.filter((s) => s !== status) : [...r.statuses, status] })

  return <div className="grid gap-3">
    <Container className="grid gap-4">
      <div><Heading level="h2">Request emails</Heading><Text size="small" className="text-ui-fg-subtle">Every hour the store mails customers whose order reached one of the statuses below and has stayed there for the delay. Each product gets five star links; a star opens the review form with their name filled in, no sign-in needed. Every order is only ever mailed once.</Text></div>
      {!emailReady ? <Text size="small" className="text-ui-fg-error">Email sending is not set up on the server (EMAILIT_API_KEY / EMAIL_FROM), so nothing can be mailed yet.</Text> : null}
      <Toggle label="Send review request emails" help={r.started_at ? `Orders that reached the status from ${new Date(r.started_at).toLocaleDateString()} on are mailed; older ones are skipped.` : "When you switch this on, orders from that day on are mailed; older ones are skipped."} checked={r.enabled} onChange={(v) => setR({ enabled: v })} />
      <div className="grid gap-4 md:grid-cols-3">
        <NumberField label="Send after" suffix="days in that status" value={r.delay_days} min={0} max={60} help="0 = at the next hourly run" onChange={(n) => setR({ delay_days: n })} />
        <NumberField label="Emails per day" value={r.batch} min={1} max={500} help="Keeps the sending rate safe for the sender's reputation." onChange={(n) => setR({ batch: n })} />
        <NumberField label="Ignore orders older than" suffix="days" value={r.max_age_days} min={1} max={3650} onChange={(n) => setR({ max_age_days: n })} />
      </div>
      <div className="grid gap-2"><Label size="small">Order statuses</Label><div className="flex flex-wrap gap-2">{STATUSES.map((s) => <Button key={s} size="small" variant={r.statuses.includes(s) ? "primary" : "secondary"} onClick={() => toggleStatus(s)}>{s}</Button>)}</div></div>
      <div><Button onClick={save} isLoading={busy} disabled={!dirty || !r.statuses.length}>Save settings</Button></div>
    </Container>

    <Container className="grid gap-3">
      <div><Heading level="h3">Send one manually</Heading><Text size="small" className="text-ui-fg-subtle">Find an order by number, email, phone or name. Mail the request straight away, or copy a link to paste into WhatsApp, Messenger or Instagram yourself. The link opens the review form with the customer's name already filled in.</Text></div>
      <div className="flex gap-2"><Input placeholder="Order number, email, phone or name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search() }} className="max-w-md" /><Button variant="secondary" onClick={search} isLoading={working === "search"} disabled={!q.trim()}>Find</Button></div>
      {found ? found.length ? found.map((o) => <div key={o.order_id} className="grid gap-2 rounded-lg border p-3">
        <Text size="small"><strong>#{o.display_id}</strong> · {o.name ?? "—"} · {o.email ?? "no email"} · {o.phone ?? "—"} · {o.status}{o.sent_at ? ` · request sent ${new Date(o.sent_at).toLocaleDateString()}` : ""}{o.note ? ` · ${o.note}` : ""}</Text>
        {o.products.map((p: any) => <div key={p.id} className="flex flex-wrap items-center gap-2"><Text size="small" className="min-w-40">{p.title}</Text><Button size="small" variant="secondary" onClick={() => copy(p.link)}>{copied === p.link ? "Copied" : "Copy link"}</Button></div>)}
        <div>{o.email ? <Button size="small" onClick={() => sendOne(o.order_id)} isLoading={working === o.order_id}>{o.sent_at ? "Send the email again" : "Send the email now"}</Button> : <Text size="xsmall" className="text-ui-fg-muted">No email on this order: copy a link and send it yourself.</Text>}</div>
      </div>) : <Text size="small">No order matched that.</Text> : null}
    </Container>

    <Container className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><Heading level="h3">Queue</Heading><Button size="small" variant="secondary" onClick={runBatch} isLoading={working === "run"} disabled={!queue?.count}>Send one batch now</Button></div>
      <Text size="small">{queue ? `${queue.count} orders are waiting for a request.` : "Loading…"}{stats ? ` ${stats.sent} sent so far.` : ""}</Text>
      {queue?.queue.length ? <ul className="grid gap-1">{queue.queue.map((o) => <li key={o.order_id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><Text size="small">#{o.display_id} · {o.name ?? "—"} · {o.email ?? "no email"} · {o.status} since {new Date(o.since).toLocaleDateString()}</Text><Button size="small" variant="secondary" onClick={() => sendOne(o.order_id)} isLoading={working === o.order_id} disabled={!o.email}>Send</Button></li>)}</ul> : null}
    </Container>

    <Container className="grid gap-3">
      <div><Heading level="h3">Emails sent</Heading><Text size="small" className="text-ui-fg-subtle">Every order that has been sent a review request{log ? ` — ${log.count} so far` : ""}.</Text></div>
      {log?.log.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-ui-fg-muted"><th className="py-2 pr-3">Sent</th><th className="pr-3">Order</th><th className="pr-3">Customer</th><th className="pr-3">Reviewed?</th><th></th></tr></thead><tbody>
        {log.log.map((row) => <tr key={row.order_id} className="border-t"><td className="py-2 pr-3">{new Date(row.sent_at).toLocaleString()}</td><td className="pr-3">#{row.display_id}</td><td className="pr-3">{row.name ?? "—"}<div className="text-xs text-ui-fg-muted">{row.email ?? "no email"}{row.phone ? ` · ${row.phone}` : ""}</div>{row.note ? <div className="text-xs text-ui-fg-error">{row.note}</div> : null}</td><td className="pr-3">{row.review ? `Yes ${"★".repeat(row.review.rating)}${row.review.status === "pending" ? " (pending)" : ""}` : "Not yet"}</td><td>{row.email ? <Button size="small" variant="transparent" onClick={() => sendOne(row.order_id)} isLoading={working === row.order_id}>Resend</Button> : null}</td></tr>)}
      </tbody></table></div> : <Text size="small">Nothing sent yet.</Text>}
      {log && log.count > 50 ? <div className="flex gap-3"><Button size="small" variant="secondary" disabled={!log.offset} onClick={() => loadLists(Math.max(0, log.offset - 50))}>« Newer</Button><Button size="small" variant="secondary" disabled={log.offset + 50 >= log.count} onClick={() => loadLists(log.offset + 50)}>Older »</Button></div> : null}
    </Container>
  </div>
}
