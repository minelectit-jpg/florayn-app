import { Alert, Badge, Button, Container, Heading, Table, Text, toast, usePrompt } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

import type { AlertRun, AlertState } from "../../../../lib/tracking/alerts"
import type { OutboxHealthRow, OutboxStatusCounts } from "../../../../lib/tracking/health"
import type { JobState, TrackingJobName } from "../../../../lib/tracking/jobs"

/**
 * Admin > Tracking > Health (TRACKING.md 3.5): is the outbox sending, what
 * is stuck and why, are the tracking jobs running, and the last day's
 * counters. Buttons put blocked/failed events back in the queue, send the
 * deliberately skipped ones, send one test event to the TEST destination and
 * send a test alert email. Polls every 30 s while the tab is visible. A
 * sub-page of Tracking, so it has no sidebar entry (no config export).
 */

type Health = {
  platforms: OutboxHealthRow[]
  jobs: Partial<Record<TrackingJobName, JobState | null>>
  counters: Record<string, number>
  variant_index: { built_at?: string; count?: number; sellable?: number } | null
  email_configured: boolean
  alerts: { enabled: boolean | null; email: string | null; states: ({ key: string } & AlertState)[]; last: AlertRun | null }
  prune: { at?: string; done?: boolean } | null
  dry_run: boolean
  enabled: { meta: boolean; tiktok: boolean }
  test: { host: string | null; meta: boolean; tiktok: boolean; meta_test_event_code: boolean }
  errors: string[]
}

type Platform = "meta" | "tiktok"

const POLL_MS = 30_000
const LABEL: Record<Platform, string> = { meta: "Meta", tiktok: "TikTok" }
const COUNT_COLUMNS: { key: keyof OutboxStatusCounts; label: string }[] = [
  { key: "pending", label: "Waiting" },
  { key: "sending", label: "Sending" },
  { key: "retry", label: "Retrying" },
  { key: "blocked", label: "Blocked" },
  { key: "failed", label: "Failed" },
  { key: "expired", label: "Expired" },
  { key: "skipped", label: "Skipped" },
  { key: "sent_24h", label: "Sent (24 h)" },
]
const JOBS: { name: TrackingJobName; label: string }[] = [
  { name: "outbox", label: "Outbox sender and alerts (every minute)" },
  { name: "rollup", label: "Live dashboard rollup (every minute)" },
  { name: "reconcile", label: "Purchase reconcile (every 5 minutes)" },
  { name: "catalog", label: "Catalog feed (every 15 minutes)" },
]
const COUNTER_LABELS: Record<string, string> = {
  "sf.untrusted": "Shop requests without the Cloudflare edge header",
  "sf.unknown_host": "Shop requests from a host that is not listed",
  "sf.rate_dropped": "Events dropped by the rate limit",
  "sf.cap_dropped": "Events dropped by the global cap",
  "sf.invalid": "Invalid events",
  "sf.forward_failed": "Batches the shop could not forward",
  "sf.bot": "Bot requests",
  "ingest.unknown_variant": "Product events with an unknown variant",
  "ingest.no_token_dropped": "Events dropped for a missing token",
  "ingest.no_destination": "Events with no destination",
  "checkout.header_rejected": "Checkout tracking header rejected",
  "checkout.untrusted": "Checkouts without the edge header",
}

function when(value: string | null | undefined): string {
  if (!value) return "never"
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "never"
}

function counterLabel(key: string): string {
  if (COUNTER_LABELS[key]) return COUNTER_LABELS[key]
  const outbox = key.match(/^outbox\.([a-z_]+)\.(meta|tiktok)\.(test|live)$/)
  return outbox ? `${LABEL[outbox[2] as Platform]} ${outbox[3] === "live" ? "live" : "TEST"}: ${outbox[1].replace("_", " ")}` : key
}

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message ?? data.error ?? "The request failed.")
  return data
}

const TrackingHealthPage = () => {
  const prompt = usePrompt()
  const [data, setData] = useState<Health | null>(null)
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState("")
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async (fresh = false) => {
    const response = await fetch(`/admin/tracking/health${fresh ? "?fresh=1" : ""}`, { credentials: "include" })
    if (!response.ok) throw new Error("Could not load tracking health.")
    setData(await response.json())
    setLoadError("")
  }, [])

  useEffect(() => {
    load().catch((error: Error) => setLoadError(error.message))
  }, [load])

  // Poll only while the tab is visible; catch up at once when it becomes visible again.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (!timer) timer = setInterval(() => { void load().catch(() => undefined) }, POLL_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load().catch(() => undefined)
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [load])

  async function act(key: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    setNote(null)
    try {
      await fn()
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : "The request failed." })
    } finally {
      setBusy("")
    }
  }

  const retry = (statuses: string[], key: string) => act(key, async () => {
    const result = await post("/admin/tracking/retry", { statuses })
    const queued = Number(result.queued ?? 0)
    toast.success(queued ? `${queued} event${queued === 1 ? "" : "s"} queued again` : "Nothing to queue")
    await load(true)
  })

  async function sendSkipped() {
    const ok = await prompt({
      title: "Send the skipped events?",
      description: "Skipped events were deliberately not sent because their platform (or live sending) was off. The ones from the last 6 days will be sent now, to the destination each was queued for. Only do this after switching the platform back on on purpose.",
      confirmText: "Send skipped events",
      cancelText: "Cancel",
    })
    if (ok) await retry(["skipped"], "skipped")
  }

  const testEvent = (platform: Platform) => act(`test-${platform}`, async () => {
    const result = await post("/admin/tracking/test-event", { platform })
    const trace = result.traceId ? ` (trace ${result.traceId})` : ""
    const where = platform === "meta" && !result.test_event_code
      ? " No test event code is set, so it will not show under Test events in Events Manager."
      : ""
    setNote({ ok: result.cls === "ok", text: `${LABEL[platform]} test event: ${result.cls}, ${result.message}${trace}.${where}` })
  })

  const testAlert = () => act("alert", async () => {
    const result = await post("/admin/tracking/test-alert", {})
    setNote(result.ok
      ? { ok: true, text: `Test alert sent to ${data?.alerts.email ?? "the alert address"}. Check the inbox and the spam folder.` }
      : { ok: false, text: `The test alert was not sent: ${result.error ?? "unknown error"}.` })
  })

  if (loadError && !data) {
    return <Container className="space-y-4">
      <Text role="alert">{loadError}</Text>
      <Button variant="secondary" onClick={() => void load().catch((error: Error) => setLoadError(error.message))}>Try again</Button>
    </Container>
  }
  if (!data) return <Container><Text>Loading tracking health...</Text></Container>

  const openAlerts = data.alerts.states.filter((state) => state.open)
  const counters = Object.entries(data.counters).sort(([a], [b]) => a.localeCompare(b))
  const index = data.variant_index

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <Heading>Tracking health</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              What the shop has queued for Meta and TikTok, what was sent, and what is stuck. Refreshes every 30 seconds.
            </Text>
          </div>
          <Link className="text-ui-fg-interactive text-sm" to="/tracking">Back to Tracking settings</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color={data.enabled.meta ? "green" : "grey"}>Meta {data.enabled.meta ? "on" : "off"}</Badge>
          <Badge color={data.enabled.tiktok ? "green" : "grey"}>TikTok {data.enabled.tiktok ? "on" : "off"}</Badge>
          {data.dry_run ? <Badge color="orange">Dry run: nothing is sent (TRACKING_DRY_RUN=1)</Badge> : null}
          <Badge color={data.alerts.enabled ? "blue" : "grey"}>Alerts {data.alerts.enabled ? `to ${data.alerts.email}` : "off"}</Badge>
        </div>
        {!data.email_configured ? <Alert variant="warning">
          Email is not configured on the server (EMAILIT_API_KEY and EMAIL_FROM), so alerts cannot be emailed.
        </Alert> : null}
        {data.errors.length ? <Alert variant="error">{data.errors.join("; ")}.</Alert> : null}
        {loadError ? <Text size="small" className="text-ui-fg-error">{loadError} Showing the last numbers.</Text> : null}
      </Container>

      {openAlerts.length ? <Container className="space-y-2">
        <Heading level="h2">Open alerts</Heading>
        <ul className="list-disc space-y-1 pl-5">
          {openAlerts.map((state) => <li key={state.key}>
            <Text size="small">{state.title || state.key}: since {when(state.since)}; last emailed {when(state.last_sent_at)}</Text>
          </li>)}
        </ul>
      </Container> : null}

      <Container className="space-y-3">
        <Heading level="h2">Outbox</Heading>
        {data.platforms.length ? <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Platform</Table.HeaderCell>
                <Table.HeaderCell>Destination</Table.HeaderCell>
                {COUNT_COLUMNS.map((column) => <Table.HeaderCell key={column.key} className="text-right">{column.label}</Table.HeaderCell>)}
                <Table.HeaderCell>Last sent</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.platforms.map((row) => <Table.Row key={`${row.platform}-${row.env}-${row.destination}`}>
                <Table.Cell>{LABEL[row.platform] ?? row.platform} {row.env === "live" ? "live" : "TEST"}</Table.Cell>
                <Table.Cell className="font-mono text-xs">{row.destination || "none"}</Table.Cell>
                {COUNT_COLUMNS.map((column) => <Table.Cell key={column.key} className="text-right">{row.counts[column.key]}</Table.Cell>)}
                <Table.Cell>{when(row.last_sent_at)}</Table.Cell>
              </Table.Row>)}
            </Table.Body>
          </Table>
        </div> : <Text size="small" className="text-ui-fg-subtle">No events have been queued yet.</Text>}
        {data.platforms.filter((row) => row.last_error).map((row) => <Text key={`error-${row.platform}-${row.env}-${row.destination}`} size="small" className="break-words">
          <strong>{LABEL[row.platform] ?? row.platform} {row.env === "live" ? "live" : "TEST"} last error</strong> ({when(row.last_error_at)}): {row.last_error}
        </Text>)}
        <Text size="xsmall" className="text-ui-fg-muted">
          Blocked: no working token (sent automatically within 6 days once one is saved). Failed: rejected for its content, or
          still failing after 8 retries. Expired: not sent within 6.5 days. Skipped: its platform or live sending was off.
        </Text>
        <div className="flex flex-wrap gap-2">
          <Button size="small" variant="secondary" isLoading={busy === "retry"} disabled={Boolean(busy)}
            onClick={() => void retry(["blocked", "failed"], "retry")}>Retry blocked and failed</Button>
          <Button size="small" variant="secondary" isLoading={busy === "skipped"} disabled={Boolean(busy)}
            onClick={() => void sendSkipped()}>Send skipped from the last 6 days</Button>
        </div>
      </Container>

      <Container className="space-y-3">
        <Heading level="h2">Tests</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          A test event goes only to the TEST destination{data.test.host ? ` of ${data.test.host}` : ""}: Meta gets a PageView,
          TikTok a ViewContent. A test alert emails {data.alerts.email ?? "the alert address"}.
        </Text>
        <div className="flex flex-wrap gap-2">
          {(["meta", "tiktok"] as Platform[]).map((platform) => <Button key={platform} size="small" variant="secondary"
            isLoading={busy === `test-${platform}`} disabled={Boolean(busy) || !data.test[platform]}
            onClick={() => void testEvent(platform)}>Send {LABEL[platform]} test event</Button>)}
          <Button size="small" variant="secondary" isLoading={busy === "alert"} disabled={Boolean(busy)}
            onClick={() => void testAlert()}>Send test alert</Button>
        </div>
        {(["meta", "tiktok"] as Platform[]).filter((platform) => !data.test[platform]).map((platform) =>
          <Text key={platform} size="xsmall" className="text-ui-fg-muted">
            {LABEL[platform]} test event: turn {LABEL[platform]} on and save its TEST {platform === "meta" ? "dataset id" : "pixel code"} and TEST token first.
          </Text>)}
        {note ? <Alert variant={note.ok ? "success" : "error"}>{note.text}</Alert> : null}
      </Container>

      <Container className="space-y-3">
        <Heading level="h2">Jobs</Heading>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Job</Table.HeaderCell>
              <Table.HeaderCell>Last run</Table.HeaderCell>
              <Table.HeaderCell>Last success</Table.HeaderCell>
              <Table.HeaderCell>Last error</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {JOBS.map(({ name, label }) => {
              const state = data.jobs[name]
              return <Table.Row key={name}>
                <Table.Cell>{label}</Table.Cell>
                <Table.Cell>{when(state?.last_run_at)}</Table.Cell>
                <Table.Cell>{when(state?.last_ok_at)}</Table.Cell>
                <Table.Cell className="break-words">{state?.last_error ? `${state.last_error} (${when(state.last_error_at)})` : "none"}</Table.Cell>
              </Table.Row>
            })}
          </Table.Body>
        </Table>
        <Text size="xsmall" className="text-ui-fg-muted">
          Old data last cleaned up: {when(data.prune?.at)}{data.prune && data.prune.done === false ? " (still in progress)" : ""}.
          Alerts last checked: {when(data.alerts.last?.at)}.
        </Text>
      </Container>

      <Container className="space-y-3">
        <Heading level="h2">Variant index</Heading>
        <Text size="small">
          {index?.built_at
            ? `Built ${when(index.built_at)}: ${index.count ?? 0} variants, ${index.sellable ?? 0} sellable.`
            : "Not built yet. Product events are only sent for variants in the index."}
        </Text>
      </Container>

      <Container className="space-y-3">
        <Heading level="h2">Counters (last 24 hours)</Heading>
        {counters.length ? <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>What</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Count</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {counters.map(([key, n]) => <Table.Row key={key}>
              <Table.Cell title={key}>{counterLabel(key)}</Table.Cell>
              <Table.Cell className="text-right">{n}</Table.Cell>
            </Table.Row>)}
          </Table.Body>
        </Table> : <Text size="small" className="text-ui-fg-subtle">Nothing counted in the last 24 hours.</Text>}
      </Container>
    </div>
  )
}

export default TrackingHealthPage
