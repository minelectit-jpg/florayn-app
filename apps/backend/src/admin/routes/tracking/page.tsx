import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Target } from "@medusajs/icons"
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import type {
  BrowserMode,
  PresentedTrackingSettings,
  TokenColumn,
  TrackingConfig,
} from "../../../lib/tracking/settings"

/**
 * Admin > Tracking (TRACKING.md 3.5): which host sends to which ad
 * destination, the Meta/TikTok/Google ids and tokens, when their browser code
 * loads, the privacy switch and the alert settings. Tokens are write-only:
 * the page only ever sees them masked. Catalog settings live on
 * Tracking > Catalog, so this page never sends them.
 */

type Payload = {
  settings: PresentedTrackingSettings
  email_configured: boolean
  privacy_published: boolean
  suggested_consent_text: string
}

type Tokens = Record<TokenColumn, string>
type Section = "meta" | "tiktok" | "google" | "privacy" | "alerts" | "dashboard"

const EMPTY_TOKENS: Tokens = { meta_test_token: "", meta_live_token: "", tiktok_test_token: "", tiktok_live_token: "" }

const BROWSER_OPTIONS: { value: BrowserMode; label: string }[] = [
  { value: "off", label: "Off (server events only)" },
  { value: "ads_only", label: "Only visitors who came from its ads" },
  { value: "all", label: "Every visitor" },
]

class SaveError extends Error {
  errors: string[]
  constructor(errors: string[]) {
    super(errors[0] ?? "Could not save the tracking settings.")
    this.errors = errors
  }
}

async function post(body: Record<string, unknown>): Promise<Payload> {
  const response = await fetch("/admin/tracking/settings", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new SaveError(Array.isArray(data.errors) ? data.errors : [data.message ?? "Could not save the tracking settings."])
  }
  return data as Payload
}

const hostsText = (hosts: string[]) => hosts.join(", ")
const hostsList = (text: string) => text.split(/[\s,]+/).map((host) => host.trim()).filter(Boolean)
const numberText = (value: number) => Number.isFinite(value) ? String(value) : ""
const toNumber = (text: string) => text.trim() === "" ? Number.NaN : Number(text)

const TrackingPage = () => {
  const prompt = usePrompt()
  const [data, setData] = useState<Payload | null>(null)
  const [form, setForm] = useState<TrackingConfig | null>(null)
  const [hosts, setHosts] = useState({ test: "", live: "" })
  const [tokens, setTokens] = useState<Tokens>(EMPTY_TOKENS)
  const [errors, setErrors] = useState<string[]>([])
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState("")
  const [alertNote, setAlertNote] = useState("")
  const [reload, setReload] = useState(0)

  function accept(payload: Payload, keepEdits: boolean) {
    setData(payload)
    if (!keepEdits) {
      setForm(payload.settings.config)
      setHosts({ test: hostsText(payload.settings.config.test_hosts), live: hostsText(payload.settings.config.live_hosts) })
      setTokens(EMPTY_TOKENS)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoadError("")
    fetch("/admin/tracking/settings", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the tracking settings.")
        accept(await response.json(), false)
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message)
      })
    return () => controller.abort()
  }, [reload])

  function setSection<K extends Section>(key: K, values: Partial<TrackingConfig[K]>) {
    setForm((current) => current ? { ...current, [key]: { ...current[key], ...values } } : current)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!form || busy) return
    setBusy("save")
    setErrors([])
    const written: Partial<Tokens> = {}
    for (const [column, value] of Object.entries(tokens) as [TokenColumn, string][]) {
      if (value.trim()) written[column] = value.trim()
    }
    try {
      accept(await post({
        test_hosts: hostsList(hosts.test),
        live_hosts: hostsList(hosts.live),
        meta: form.meta,
        tiktok: form.tiktok,
        google: form.google,
        privacy: { share_contact_hashes: form.privacy.share_contact_hashes, consent_text: form.privacy.consent_text },
        alerts: form.alerts,
        dashboard: form.dashboard,
        ...written,
      }), false)
      toast.success("Tracking settings saved")
    } catch (error) {
      setErrors(error instanceof SaveError ? error.errors : ["Could not reach the server. Your edits are still here; please try again."])
    } finally {
      setBusy("")
    }
  }

  async function saveNow(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key)
    try {
      const payload = await post(body)
      accept(payload, true)
      setForm((current) => current ? { ...current, live_armed: payload.settings.config.live_armed } : current)
      toast.success(done)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.")
    } finally {
      setBusy("")
    }
  }

  async function setArmed(on: boolean) {
    if (on) {
      const ok = await prompt({
        title: "Allow live sending?",
        description: "Orders and visits on the live hosts will be sent to the LIVE Meta dataset, the live TikTok pixel and Google Ads (for each platform that is on). Only do this at cutover, after Automatic Advanced Matching is off on the live dataset.",
        confirmText: "Allow live sending",
        cancelText: "Cancel",
      })
      if (!ok) return
    }
    await saveNow("armed", { live_armed: on }, on ? "Live sending allowed" : "Live sending stopped")
  }

  async function removeToken(column: TokenColumn, label: string) {
    const ok = await prompt({
      title: `Remove the ${label}?`,
      description: "Events for this destination wait (Purchases are kept as blocked) until a new token is pasted.",
      confirmText: "Remove",
      cancelText: "Cancel",
    })
    if (ok) await saveNow(column, { [column]: "__remove__" }, `${label} removed`)
  }

  async function sendTestAlert() {
    setBusy("alert")
    setAlertNote("")
    try {
      const response = await fetch("/admin/tracking/test-alert", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      if (response.status === 404) {
        setAlertNote("Test alerts are not installed on this server yet. They arrive with Tracking > Health.")
        return
      }
      const result = await response.json().catch(() => ({}))
      setAlertNote(result.ok ? `Test alert sent to ${data?.settings.config.alerts.email}. Check the inbox and spam folder.`
        : `The test alert was not sent: ${result.error ?? result.message ?? "unknown error"}.`)
    } catch {
      setAlertNote("Could not reach the server.")
    } finally {
      setBusy("")
    }
  }

  if (loadError) {
    return <Container className="space-y-4">
      <Text role="alert">{loadError}</Text>
      <Button variant="secondary" onClick={() => setReload((value) => value + 1)}>Try again</Button>
    </Container>
  }
  if (!data || !form) return <Container><Text>Loading tracking settings...</Text></Container>

  const saved = data.settings.config
  const settings = data.settings
  const consentSaved = Boolean(saved.privacy.consent_text)
  const canShare = data.privacy_published && consentSaved
  const tokenField = (column: TokenColumn, label: string, help: string) => {
    const set = settings[`${column}_set`]
    return <div className="grid gap-1">
      <Label htmlFor={column} size="small">{set ? `${label} (saved ${settings[`${column}_masked`]})` : `${label} (not set)`}</Label>
      <div className="flex gap-2">
        <Input id={column} name={`tracking-${column}`} value={tokens[column]} autoComplete="one-time-code"
          spellCheck={false} data-1p-ignore data-lpignore="true"
          style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
          placeholder="Paste a new token to replace it"
          onChange={(event) => setTokens({ ...tokens, [column]: event.target.value })} />
        {set ? <Button type="button" variant="secondary" size="small" disabled={Boolean(busy)}
          onClick={() => void removeToken(column, label)}>Remove</Button> : null}
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">{help}</Text>
    </div>
  }
  const modeSelect = (id: string, value: BrowserMode, onChange: (value: BrowserMode) => void) =>
    <Select value={value} onValueChange={(next) => onChange(next as BrowserMode)}>
      <Select.Trigger id={id}><Select.Value /></Select.Trigger>
      <Select.Content>{BROWSER_OPTIONS.map((option) =>
        <Select.Item key={option.value} value={option.value}>{option.label}</Select.Item>)}</Select.Content>
    </Select>

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="space-y-4">
        <div className="space-y-1">
          <Heading>Tracking</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Sends visits, product views, bag adds, checkouts and orders to Meta, TikTok and Google Ads, straight from
            the shop. Where each site&apos;s events go is decided by its address below.
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          {saved.test_hosts.map((host) => <Badge key={host} color="blue">{host} → TEST</Badge>)}
          {saved.live_hosts.map((host) => <Badge key={host} color={saved.live_armed ? "green" : "grey"}>
            {host} → {saved.live_armed ? "LIVE, armed" : "TEST, live disarmed"}</Badge>)}
          <Badge color={saved.meta.enabled ? "green" : "grey"}>Meta {saved.meta.enabled ? "on" : "off"}</Badge>
          <Badge color={saved.tiktok.enabled ? "green" : "grey"}>TikTok {saved.tiktok.enabled ? "on" : "off"}</Badge>
          <Badge color={saved.google.enabled ? "green" : "grey"}>Google Ads {saved.google.enabled ? "on" : "off"}</Badge>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link className="text-ui-fg-interactive" to="/tracking/health">Health: queues, errors and test events</Link>
          <Link className="text-ui-fg-interactive" to="/tracking/catalog">Catalog feed</Link>
          <Link className="text-ui-fg-interactive" to="/live">Live dashboard</Link>
        </div>
        {!data.email_configured ? <Alert variant="warning">
          Alert emails cannot be sent: EMAILIT_API_KEY and EMAIL_FROM are not set on the server.
        </Alert> : null}
      </Container>

      <Container className="space-y-4">
        <Heading level="h2">Sites</Heading>
        <div className="flex items-start gap-3">
          <Switch id="live_armed" checked={saved.live_armed} disabled={Boolean(busy)}
            onCheckedChange={(on) => void setArmed(on)} />
          <div>
            <Label htmlFor="live_armed">Allow live sending</Label>
            <Text size="small" className="text-ui-fg-subtle">
              Off: the live hosts send to the TEST destinations. Turn on at cutover only. Turning it off is the
              quickest way to stop live sends: new events switch to TEST within a few minutes.
            </Text>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="test_hosts" size="small">Test hosts</Label>
            <Input id="test_hosts" value={hosts.test} onChange={(event) => setHosts({ ...hosts, test: event.target.value })} />
            <Text size="xsmall" className="text-ui-fg-muted">Always send to TEST. Separate with commas, at most 5.</Text>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="live_hosts" size="small">Live hosts</Label>
            <Input id="live_hosts" value={hosts.live} onChange={(event) => setHosts({ ...hosts, live: event.target.value })} />
            <Text size="xsmall" className="text-ui-fg-muted">Send to LIVE only while live sending is allowed. Any other address sends nothing.</Text>
          </div>
        </div>
      </Container>

      <form onSubmit={save} className="flex flex-col gap-y-4">
        <fieldset disabled={busy === "save"} className="flex flex-col gap-y-4">
          <Container className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Heading level="h2">Meta (Facebook and Instagram)</Heading>
              <Switch id="meta_enabled" checked={form.meta.enabled} onCheckedChange={(on) => setSection("meta", { enabled: on })} />
              <Label htmlFor="meta_enabled" size="small">Send to Meta</Label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="meta_test_id" size="small">TEST dataset id</Label>
                <Input id="meta_test_id" inputMode="numeric" value={form.meta.test_id} onChange={(event) => setSection("meta", { test_id: event.target.value })} />
              </div>
              {tokenField("meta_test_token", "TEST token", "Events Manager > the TEST dataset > Settings > Conversions API > Generate access token.")}
              <div className="grid gap-1">
                <Label htmlFor="meta_test_event_code" size="small">Test event code (optional)</Label>
                <Input id="meta_test_event_code" value={form.meta.test_event_code} placeholder="TEST12345"
                  onChange={(event) => setSection("meta", { test_event_code: event.target.value })} />
                <Text size="xsmall" className="text-ui-fg-muted">From the Test events tab; TEST-dataset events then show up there. Leave empty after QA.</Text>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="meta_live_id" size="small">Live dataset id</Label>
                <Input id="meta_live_id" inputMode="numeric" value={form.meta.live_id} onChange={(event) => setSection("meta", { live_id: event.target.value })} />
              </div>
              {tokenField("meta_live_token", "Live token", "Generated the same way on the live dataset. Used only while live sending is allowed.")}
              <div className="grid gap-1">
                <Label htmlFor="meta_api_version" size="small">Graph API version</Label>
                <Input id="meta_api_version" value={form.meta.api_version} onChange={(event) => setSection("meta", { api_version: event.target.value })} />
                <Text size="xsmall" className="text-ui-fg-muted">Leave as is unless Meta retires it.</Text>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="meta_browser" size="small">Load the Meta pixel for</Label>
                {modeSelect("meta_browser", form.meta.browser, (value) => setSection("meta", { browser: value }))}
              </div>
            </div>
            <div className="grid gap-3">
              <Alert variant="warning">
                Turn it OFF in Events Manager before ticking; the browser pixel stays off for that dataset until you do.
              </Alert>
              {(["test", "live"] as const).map((env) => <div key={env} className="flex items-start gap-2">
                <Checkbox id={`aam_${env}`} checked={form.meta.aam_off_confirmed[env]}
                  onCheckedChange={(value) => setSection("meta", { aam_off_confirmed: { ...form.meta.aam_off_confirmed, [env]: value === true } })} />
                <Label htmlFor={`aam_${env}`} size="small">
                  Automatic Advanced Matching is OFF on the {env === "test" ? "TEST" : "live"} dataset
                </Label>
              </div>)}
            </div>
            <div className="grid gap-2">
              <Text size="small" weight="plus">Cash-on-delivery events</Text>
              <Text size="xsmall" className="text-ui-fg-muted">Sent to Meta when an order moves on in the Order Manager, so ads can learn which orders were real.</Text>
              {(["OrderConfirmed", "Delivered", "Returned"] as const).map((name) => <div key={name} className="flex items-center gap-2">
                <Checkbox id={`status_${name}`} checked={form.meta.status_events[name]}
                  onCheckedChange={(value) => setSection("meta", { status_events: { ...form.meta.status_events, [name]: value === true } })} />
                <Label htmlFor={`status_${name}`} size="small">{name}</Label>
              </div>)}
            </div>
          </Container>

          <Container className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Heading level="h2">TikTok</Heading>
              <Switch id="tiktok_enabled" checked={form.tiktok.enabled} onCheckedChange={(on) => setSection("tiktok", { enabled: on })} />
              <Label htmlFor="tiktok_enabled" size="small">Send to TikTok</Label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="tiktok_test_id" size="small">TEST pixel code</Label>
                <Input id="tiktok_test_id" value={form.tiktok.test_id} onChange={(event) => setSection("tiktok", { test_id: event.target.value })} />
                <Text size="xsmall" className="text-ui-fg-muted">Empty: TikTok sends nothing from the test hosts.</Text>
              </div>
              {tokenField("tiktok_test_token", "TEST token", "TikTok Events Manager > the TEST pixel > Settings > Generate access token.")}
              <div className="grid gap-1">
                <Label htmlFor="tiktok_live_id" size="small">Live pixel code</Label>
                <Input id="tiktok_live_id" value={form.tiktok.live_id} onChange={(event) => setSection("tiktok", { live_id: event.target.value })} />
              </div>
              {tokenField("tiktok_live_token", "Live token", "Used only while live sending is allowed.")}
              <div className="grid gap-1">
                <Label htmlFor="tiktok_browser" size="small">Load the TikTok pixel for</Label>
                {modeSelect("tiktok_browser", form.tiktok.browser, (value) => setSection("tiktok", { browser: value }))}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="spa_off" checked={form.tiktok.spa_off_confirmed}
                onCheckedChange={(value) => setSection("tiktok", { spa_off_confirmed: value === true })} />
              <div>
                <Label htmlFor="spa_off" size="small">SPA page views, automatic events and automatic advanced matching are OFF in both pixels</Label>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Turn all three OFF in TikTok Events Manager before ticking: automatic advanced matching reads the checkout's phone and email fields. The TikTok pixel does not load until this is ticked.
                </Text>
              </div>
            </div>
          </Container>

          <Container className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Heading level="h2">Google Ads</Heading>
              <Switch id="google_enabled" checked={form.google.enabled} onCheckedChange={(on) => setSection("google", { enabled: on })} />
              <Label htmlFor="google_enabled" size="small">Send purchases to Google Ads</Label>
            </div>
            <Text size="small" className="text-ui-fg-subtle">Only on live hosts while live sending is allowed: Google has no test destination.</Text>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-1">
                <Label htmlFor="google_conversion_id" size="small">Conversion id</Label>
                <Input id="google_conversion_id" value={form.google.conversion_id} placeholder="AW-123456789"
                  onChange={(event) => setSection("google", { conversion_id: event.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="google_purchase_label" size="small">Purchase conversion label</Label>
                <Input id="google_purchase_label" value={form.google.purchase_label}
                  onChange={(event) => setSection("google", { purchase_label: event.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="google_browser" size="small">Load the Google tag for</Label>
                {modeSelect("google_browser", form.google.browser, (value) => setSection("google", { browser: value }))}
              </div>
            </div>
          </Container>

          <Container className="space-y-4">
            <Heading level="h2">Privacy</Heading>
            <div className="grid gap-1">
              <Label htmlFor="consent_text" size="small">Checkout consent sentence (version {saved.privacy.consent_version})</Label>
              <Textarea id="consent_text" rows={3} maxLength={600} value={form.privacy.consent_text}
                onChange={(event) => setSection("privacy", { consent_text: event.target.value })} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" size="small"
                  onClick={() => setSection("privacy", { consent_text: data.suggested_consent_text })}>Use suggested wording</Button>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Shown under Place order, with a link to the Privacy page, only while sharing is on. Florayn must check and approve the wording.
                </Text>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Switch id="share_contact_hashes" checked={form.privacy.share_contact_hashes}
                disabled={!canShare && !form.privacy.share_contact_hashes}
                onCheckedChange={(on) => setSection("privacy", { share_contact_hashes: on })} />
              <div>
                <Label htmlFor="share_contact_hashes">Share hashed contact details</Label>
                <Text size="small" className="text-ui-fg-subtle">
                  Sends a scrambled (SHA-256) copy of the buyer&apos;s phone, name, district and email with each order, so ads match better.
                  Off: orders carry only the visitor id, IP address and browser details.
                </Text>
                {!canShare ? <Text size="small" className="text-ui-fg-subtle">
                  Available once the <Link className="text-ui-fg-interactive" to="/privacy">Privacy page</Link> is
                  published{consentSaved ? "" : " and a consent sentence is saved"}.
                </Text> : null}
              </div>
            </div>
          </Container>

          <Container className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Heading level="h2">Alerts</Heading>
              <Switch id="alerts_enabled" checked={form.alerts.enabled} onCheckedChange={(on) => setSection("alerts", { enabled: on })} />
              <Label htmlFor="alerts_enabled" size="small">Email me when tracking breaks</Label>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-1 md:col-span-3">
                <Label htmlFor="alerts_email" size="small">Alert email</Label>
                <Input id="alerts_email" type="email" value={form.alerts.email} onChange={(event) => setSection("alerts", { email: event.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="alerts_from" size="small">&quot;No Purchase&quot; alerts from (hour, Dhaka)</Label>
                <Input id="alerts_from" type="number" min={0} max={24} value={numberText(form.alerts.active_from_hour)}
                  onChange={(event) => setSection("alerts", { active_from_hour: toNumber(event.target.value) })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="alerts_to" size="small">until (hour, Dhaka)</Label>
                <Input id="alerts_to" type="number" min={0} max={24} value={numberText(form.alerts.active_to_hour)}
                  onChange={(event) => setSection("alerts", { active_to_hour: toNumber(event.target.value) })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="alerts_window" size="small">Alert after this many hours without a Purchase</Label>
                <Input id="alerts_window" type="number" min={1} max={12} value={numberText(form.alerts.no_purchase_hours)}
                  onChange={(event) => setSection("alerts", { no_purchase_hours: toNumber(event.target.value) })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="alerts_repeat" size="small">Repeat an open alert every (hours)</Label>
                <Input id="alerts_repeat" type="number" min={1} max={48} value={numberText(form.alerts.repeat_hours)}
                  onChange={(event) => setSection("alerts", { repeat_hours: toNumber(event.target.value) })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="small" isLoading={busy === "alert"} disabled={Boolean(busy)}
                onClick={() => void sendTestAlert()}>Send test alert</Button>
              {alertNote ? <Text size="small">{alertNote}</Text> : <Text size="xsmall" className="text-ui-fg-muted">Sends to the saved alert email.</Text>}
            </div>
          </Container>

          <Container className="space-y-4">
            <Heading level="h2">Live dashboard</Heading>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="daily_target" size="small">Daily order target</Label>
                <Input id="daily_target" type="number" min={1} max={100000} value={numberText(form.dashboard.daily_order_target)}
                  onChange={(event) => setSection("dashboard", { daily_order_target: toNumber(event.target.value) })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="poll_seconds" size="small">Refresh every (seconds)</Label>
                <Input id="poll_seconds" type="number" min={10} max={60} value={numberText(form.dashboard.poll_seconds)}
                  onChange={(event) => setSection("dashboard", { poll_seconds: toNumber(event.target.value) })} />
              </div>
            </div>
          </Container>

          <Container className="space-y-3">
            {errors.length ? <Alert variant="error">
              <ul className="list-disc pl-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </Alert> : null}
            <Button type="submit" isLoading={busy === "save"} disabled={Boolean(busy)}>Save tracking settings</Button>
          </Container>
        </fieldset>
      </form>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Tracking", icon: Target })

export default TrackingPage
