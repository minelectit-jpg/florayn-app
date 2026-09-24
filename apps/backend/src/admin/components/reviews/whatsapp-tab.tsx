import { Badge, Button, Container, Heading, Input, Label, Switch, Text, toast } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { api, post } from "../product-manager/shared"

export type WhatsAppInfo = {
  enabled: boolean
  phone_number_id: string
  business_account_id: string
  api_version: string
  access_token_set: boolean
  access_token_masked: string
  ready: boolean
}
type Template = { key: string; name: string; language: string; category: string; body: string; button: { text: string; url: string } | null }
type Check = {
  phone: { number: string | null; name: string | null; quality: string | null; name_status: string | null } | null
  phone_error: string | null
  templates: { name: string; status: string; language: string; category: string | null; rejected_reason: string | null }[]
  templates_error: string | null
}

/** The saved WhatsApp connection; the review tabs read `ready` from it. */
export function useWhatsApp() {
  const [info, setInfo] = useState<WhatsAppInfo | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const load = useCallback(async () => {
    const r = await api("/admin/whatsapp")
    setInfo(r.settings); setTemplates(r.templates)
  }, [])
  useEffect(() => { void load().catch(() => undefined) }, [load])
  return { info, templates, setInfo, reload: load }
}

const STATUS_COLOR: Record<string, "green" | "orange" | "red" | "grey"> = { APPROVED: "green", PENDING: "orange", IN_APPEAL: "orange", REJECTED: "red", PAUSED: "red", DISABLED: "red", MISSING: "grey" }

/**
 * Admin > Reviews > WhatsApp: connect the shop's WhatsApp Business number
 * (Meta Cloud API), submit the two review templates, and send a test. Until
 * this is connected, the WhatsApp buttons on the other tabs still work: they
 * open the customer's chat with the message typed in, to send by hand.
 */
export function WhatsAppTab({ whatsapp }: { whatsapp: ReturnType<typeof useWhatsApp> }) {
  const { info, templates, setInfo } = whatsapp
  const [form, setForm] = useState({ phone_number_id: "", business_account_id: "", access_token: "", api_version: "" })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState("")
  const [check, setCheck] = useState<Check | null>(null)
  const [results, setResults] = useState<{ name: string; result: string }[] | null>(null)
  const [testTo, setTestTo] = useState("")
  useEffect(() => {
    if (info) setForm({ phone_number_id: info.phone_number_id, business_account_id: info.business_account_id, access_token: "", api_version: info.api_version })
  }, [info])

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try { await fn() } catch (e: any) { toast.error(e.message) } finally { setBusy("") }
  }
  const save = (patch: Record<string, unknown> = {}) => run("save", async () => {
    setErrors({})
    const body = { ...form, ...patch }
    const response = await fetch("/admin/whatsapp", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { setErrors(data.errors ?? {}); throw new Error(data.message || "Could not save.") }
    setInfo(data.settings); setForm((f) => ({ ...f, access_token: "" }))
    toast.success("WhatsApp settings saved.")
  })
  const runCheck = () => run("check", async () => { setCheck(await post("/admin/whatsapp/check", {})) })
  const submit = () => run("templates", async () => { setResults((await post("/admin/whatsapp/templates", {})).results); setCheck(await post("/admin/whatsapp/check", {}).catch(() => null)) })
  const test = () => run("test", async () => { await post("/admin/whatsapp/test", { to: testTo }); toast.success("Test message sent. Check that phone's WhatsApp.") })

  if (!info) return <Container><Text>Loading…</Text></Container>
  const field = (key: keyof typeof form, label: string, help: string, props: Record<string, unknown> = {}) => <div className="grid gap-1">
    <Label size="small">{label}</Label>
    <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    {errors[key] ? <Text size="xsmall" className="text-ui-fg-error">{errors[key]}</Text> : <Text size="xsmall" className="text-ui-fg-muted">{help}</Text>}
  </div>

  return <div className="grid gap-3">
    <Container className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3"><Heading level="h2">WhatsApp</Heading><Badge color={info.ready ? "green" : "grey"}>{info.ready ? "Connected" : info.enabled ? "Missing details" : "Off"}</Badge></div>
      <Text size="small" className="text-ui-fg-subtle">Customers who ordered with only a phone number get their review request, and their discount code, on WhatsApp. This uses the WhatsApp Business Platform (Meta Cloud API): Meta charges per message, and messages go out as templates Meta has approved.</Text>
      <Text size="small" className="text-ui-fg-subtle">Not ready yet? The WhatsApp buttons on the Request emails and Coupon rewards tabs work right now without any of this: they open that customer&apos;s chat in your own WhatsApp with the message and link typed in, and you press send.</Text>
    </Container>

    <Container className="grid gap-4">
      <div><Heading level="h3">Connection</Heading><Text size="small" className="text-ui-fg-subtle">From Meta&apos;s WhatsApp Manager (business.facebook.com &gt; WhatsApp Accounts).</Text></div>
      <label className="flex items-start gap-3">
        <Switch checked={info.enabled} onCheckedChange={(v) => void save({ enabled: v })} />
        <span><Text size="small" weight="plus">Send messages on WhatsApp</Text><Text size="xsmall" className="text-ui-fg-muted">Nothing is sent on WhatsApp while this is off.</Text></span>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        {field("phone_number_id", "Phone number ID", "WhatsApp Manager > Phone numbers > the number > Phone number ID (not the phone number itself).", { inputMode: "numeric" })}
        {field("business_account_id", "WhatsApp Business Account ID", "Shown at the top of WhatsApp Manager. Needed for the templates.", { inputMode: "numeric" })}
        {field("access_token", info.access_token_set ? `Access token (saved ${info.access_token_masked})` : "Access token", "A permanent System User token with whatsapp_business_messaging and whatsapp_business_management. Leave blank to keep the saved one.", { name: "wa-access-token", autoComplete: "one-time-code", spellCheck: false, "data-1p-ignore": true, "data-lpignore": "true", style: { WebkitTextSecurity: "disc" }, placeholder: info.access_token_set ? "Paste a new token to replace it" : "EAA…" })}
        {field("api_version", "Graph API version", "Leave as is unless Meta retires it.")}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save()} isLoading={busy === "save"}>Save</Button>
        <Button variant="secondary" onClick={runCheck} isLoading={busy === "check"} disabled={!info.access_token_set || !info.phone_number_id}>Check connection</Button>
      </div>
      {check ? <div className="grid gap-1 rounded-lg border p-3">
        {check.phone ? <Text size="small">Sending number: <strong>{check.phone.number}</strong> · {check.phone.name}{check.phone.quality ? ` · quality ${check.phone.quality}` : ""}{check.phone.name_status ? ` · display name ${check.phone.name_status.toLowerCase().replace(/_/g, " ")}` : ""}</Text> : <Text size="small" className="text-ui-fg-error">Number: {check.phone_error}</Text>}
        {check.templates_error ? <Text size="small" className="text-ui-fg-error">Templates: {check.templates_error}</Text> : check.templates.map((t) => <Text key={t.name} size="small">{t.name}: <Badge size="2xsmall" color={STATUS_COLOR[t.status] ?? "grey"}>{t.status === "MISSING" ? "not submitted" : t.status.toLowerCase()}</Badge>{t.rejected_reason && t.rejected_reason !== "NONE" ? ` (${t.rejected_reason})` : ""}</Text>)}
      </div> : null}
    </Container>

    <Container className="grid gap-3">
      <div><Heading level="h3">Message templates</Heading><Text size="small" className="text-ui-fg-subtle">WhatsApp only lets a business start a chat with a template Meta has approved. Submit these two once; approval usually takes minutes, at most a day. The names and language are set on the Request emails tab.</Text></div>
      {templates.map((t) => <div key={t.key} className="grid gap-1 rounded-lg border p-3">
        <Text size="small" weight="plus">{t.key === "request" ? "Review request" : "Review code"} · <code>{t.name}</code> · {t.language} · {t.category.toLowerCase()}</Text>
        <Text size="small" className="whitespace-pre-wrap">{t.body}</Text>
        {t.button ? <Text size="xsmall" className="text-ui-fg-muted">Button “{t.button.text}” → {t.button.url}</Text> : null}
      </div>)}
      <div><Button variant="secondary" onClick={submit} isLoading={busy === "templates"} disabled={!info.access_token_set || !info.business_account_id}>Submit templates to Meta</Button></div>
      {results ? results.map((r) => <Text key={r.name} size="small">{r.name}: {r.result}</Text>) : null}
    </Container>

    <Container className="grid gap-3">
      <div><Heading level="h3">Send a test</Heading><Text size="small" className="text-ui-fg-subtle">Sends the review request, with sample words, to your own number. Works once the request template is approved.</Text></div>
      <div className="flex flex-wrap gap-2"><Input placeholder="01XXXXXXXXX" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="max-w-56" inputMode="tel" /><Button variant="secondary" onClick={test} isLoading={busy === "test"} disabled={!info.ready || !testTo.trim()}>Send test</Button></div>
    </Container>

    <Container className="grid gap-2">
      <Heading level="h3">Setting it up</Heading>
      <ol className="grid list-decimal gap-1 pl-5 text-sm">
        <li>In Meta Business Suite (business.facebook.com), open WhatsApp Accounts and add a WhatsApp Business account for Florayn, with a phone number that is not already used in the WhatsApp app (or move it over).</li>
        <li>Verify the business (Business settings &gt; Security Centre) and add a payment method in WhatsApp Manager, so the number can message customers.</li>
        <li>Business settings &gt; Users &gt; System users: add a system user, give it the WhatsApp account, and generate a token with whatsapp_business_messaging and whatsapp_business_management. Choose “Never” for expiry.</li>
        <li>Paste the Phone number ID, the WhatsApp Business Account ID and the token above, save, switch it on, then Check connection.</li>
        <li>Submit templates to Meta, wait for both to show approved, and send yourself a test.</li>
      </ol>
      <Text size="xsmall" className="text-ui-fg-muted">When the shop moves to florayn.com, submit the request template again under a new name (its button points at this shop&apos;s address) and set that name on the Request emails tab.</Text>
    </Container>
  </div>
}
