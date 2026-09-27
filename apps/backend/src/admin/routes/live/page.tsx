import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartActivity } from "@medusajs/icons"
import { Alert, Badge, Button, Container, Copy, Heading, Select, Table, Tabs, Text } from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"

import type { JobState, TrackingJobName } from "../../../lib/tracking/jobs"
import type { LiveCounts, LiveFunnel, LivePayload, ReportPayload, StaffLink } from "../../../lib/tracking/live"
import { LiveSpark, type SparkDatum, type SparkSeries } from "../../components/tracking/live-spark"
import { DimTable, PRODUCT_COLUMNS, RecentTable, SESSION_COLUMNS, taka } from "../../components/tracking/live-tables"

/**
 * Admin > Live (TRACKING.md 9): who is on the shop now, today against
 * yesterday at the same time, orders against the daily target with a pace
 * projection, the funnel, a 5-minute chart, today's sources, products, models
 * and case types, recent activity and the tracking health; 7 and 30 day
 * tabs; and the "Exclude this browser" links for staff phones. It replaces
 * GA4 for the owner. It polls every `poll_seconds` (Admin > Tracking) only
 * while this tab is visible and on Today; the server shares one result for
 * 10 s, so extra tabs cost nothing. It renders with an empty database.
 */

type Tab = "today" | "7d" | "30d"

const SPARK_SERIES: SparkSeries[] = [
  { key: "pv", label: "Page views", kind: "line", className: "text-ui-tag-blue-icon" },
  { key: "vc", label: "Product views", kind: "line", className: "text-ui-tag-orange-icon" },
  { key: "atc", label: "Add to cart", kind: "bar", className: "text-ui-fg-subtle" },
  { key: "ic", label: "Checkouts", kind: "dot", className: "text-ui-tag-neutral-icon" },
  { key: "p", label: "Orders", kind: "dot", className: "text-ui-tag-green-icon" },
]

const REPORT_SERIES: SparkSeries[] = [
  { key: "sessions", label: "Sessions", kind: "line", className: "text-ui-tag-blue-icon" },
  { key: "product_views", label: "Product views", kind: "line", className: "text-ui-tag-orange-icon" },
  { key: "add_to_cart", label: "Add to cart", kind: "bar", className: "text-ui-fg-subtle" },
  { key: "purchases", label: "Web orders", kind: "dot", className: "text-ui-tag-green-icon" },
]

const CARDS: { key: keyof LiveCounts; label: string; money?: boolean }[] = [
  { key: "visitors", label: "Visitors" },
  { key: "sessions", label: "Sessions" },
  { key: "page_views", label: "Page views" },
  { key: "product_views", label: "Product views" },
  { key: "add_to_cart", label: "Add to cart" },
  { key: "initiate_checkout", label: "Checkouts started" },
  { key: "web_purchases", label: "Web orders" },
  { key: "revenue_web", label: "Web order value", money: true },
  { key: "orders_all", label: "All orders" },
  { key: "revenue_all", label: "Revenue", money: true },
  { key: "aov", label: "Average order", money: true },
]

const JOBS: { name: TrackingJobName; label: string }[] = [
  { name: "rollup", label: "Dashboard rollup" },
  { name: "outbox", label: "Outbox sender" },
  { name: "reconcile", label: "Purchase reconcile" },
  { name: "catalog", label: "Catalog feed" },
]

const PLATFORM: Record<string, string> = { meta: "Meta", tiktok: "TikTok" }

function count(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`
}

function ago(iso: string | null | undefined, now: number): string {
  const at = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(at)) return "never"
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

function change(now: number, before: number, format: (n: number) => string): string {
  if (!before) return now ? "none at this time yesterday" : "same as yesterday"
  const pct = Math.round(((now - before) / before) * 100)
  return `${pct > 0 ? "+" : ""}${pct}% vs ${format(before)} yesterday`
}

function filterValue(key: string): string {
  return key.startsWith("host:") ? key.slice(5) : key
}

function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : day
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include" })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data?.message ?? "The request failed."), { status: response.status })
  return data as T
}

function Funnel({ funnel }: { funnel: LiveFunnel }) {
  const steps = [
    { label: "Sessions", n: funnel.sessions, note: "" },
    { label: "Viewed a product", n: funnel.vc, note: `${percent(funnel.vc_rate)} of sessions` },
    { label: "Added to cart", n: funnel.atc, note: `${percent(funnel.atc_rate)} of product viewers` },
    { label: "Started checkout", n: funnel.ic, note: `${percent(funnel.ic_rate)} of carts` },
    { label: "Ordered", n: funnel.purchase, note: `${percent(funnel.purchase_rate)} of checkouts` },
  ]
  const top = Math.max(1, funnel.sessions)
  return (
    <div className="space-y-2">
      {steps.map((step) => <div key={step.label} className="grid grid-cols-[10rem_1fr_auto] items-center gap-3">
        <Text size="small">{step.label}</Text>
        <div className="h-2 overflow-hidden rounded-full bg-ui-bg-component">
          <div className="h-full bg-ui-fg-interactive" style={{ width: `${Math.min(100, (step.n / top) * 100)}%` }} />
        </div>
        <Text size="small" className="whitespace-nowrap tabular-nums">{count(step.n)}{step.note ? <span className="text-ui-fg-subtle"> ({step.note})</span> : null}</Text>
      </div>)}
      <Text size="small" className="text-ui-fg-subtle">Conversion: {percent(funnel.conversion)} of sessions ordered.</Text>
    </div>
  )
}

function Cards({ today, yesterday }: { today: LiveCounts; yesterday: LiveCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {CARDS.map((card) => {
        const now = Number(today[card.key] ?? 0)
        const before = Number(yesterday[card.key] ?? 0)
        const format = card.money ? taka : count
        return <div key={card.key} className="rounded-lg border border-ui-border-base p-3">
          <Text size="xsmall" className="text-ui-fg-subtle">{card.label}</Text>
          <Text size="xlarge" weight="plus" className="tabular-nums">{format(now)}</Text>
          <Text size="xsmall" className="text-ui-fg-muted">{change(now, before, format)}</Text>
        </div>
      })}
    </div>
  )
}

function Target({ today }: { today: LiveCounts }) {
  const net = today.orders_all - today.orders_cancelled
  const share = today.target > 0 ? Math.min(100, (net / today.target) * 100) : 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Text weight="plus">{count(net)} of {count(today.target)} orders today</Text>
        <Text size="small" className="text-ui-fg-subtle">
          {today.pace_projection === null ? "Pace: not enough order history yet" : `Pace: about ${count(today.pace_projection)} by midnight`}
        </Text>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-ui-bg-component">
        <div className="h-full bg-ui-tag-green-icon" style={{ width: `${share}%` }} />
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">
        {today.orders_cancelled ? `${count(today.orders_cancelled)} cancelled order${today.orders_cancelled === 1 ? " is" : "s are"} not counted. ` : ""}
        The target is set in Tracking settings.
      </Text>
    </div>
  )
}

function Health({ live }: { live: LivePayload }) {
  const now = Date.parse(live.generated_at)
  const health = live.health
  const jobs = (health.jobs ?? {}) as Partial<Record<TrackingJobName, JobState | null>>
  const published = (health.feed?.builds ?? []).filter((build) => build.kind === "published")
  const lag = health.rollup_lag_s
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge color={lag === null ? "grey" : lag > 600 ? "red" : lag > 120 ? "orange" : "green"}>
          Rollup {lag === null ? "has not run yet" : `${Math.round(lag / 60)} min behind`}
        </Badge>
        <Badge color={(health.unknown_content_ids_today ?? 0) > 0 ? "orange" : "grey"}>
          Unknown product ids today: {count(health.unknown_content_ids_today ?? 0)}
        </Badge>
        <Badge color={health.variant_index?.built_at ? "grey" : "orange"}>
          Variant index: {health.variant_index?.built_at ? `${count(health.variant_index.count ?? 0)} variants, built ${ago(health.variant_index.built_at, now)}` : "not built yet"}
        </Badge>
      </div>
      {health.outbox?.length ? <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Outbox</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Waiting</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Blocked</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Failed</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Sent (24 h)</Table.HeaderCell>
              <Table.HeaderCell>Last sent</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {health.outbox.map((row) => <Table.Row key={`${row.platform}-${row.env}-${row.destination}`}>
              <Table.Cell>{PLATFORM[row.platform] ?? row.platform} {row.env === "live" ? "live" : "TEST"}</Table.Cell>
              <Table.Cell className="text-right tabular-nums">{count(row.counts.pending + row.counts.retry + row.counts.sending)}</Table.Cell>
              <Table.Cell className="text-right tabular-nums">{count(row.counts.blocked)}</Table.Cell>
              <Table.Cell className="text-right tabular-nums">{count(row.counts.failed)}</Table.Cell>
              <Table.Cell className="text-right tabular-nums">{count(row.counts.sent_24h)}</Table.Cell>
              <Table.Cell>{ago(row.last_sent_at, now)}</Table.Cell>
            </Table.Row>)}
          </Table.Body>
        </Table>
      </div> : <Text size="small" className="text-ui-fg-subtle">Nothing has been queued for Meta or TikTok yet.</Text>}
      <Text size="small">
        Jobs: {JOBS.map((job) => {
          const state = jobs[job.name]
          const ran = state?.last_run_at ? `ran ${ago(state.last_run_at, now)}` : "has not run yet"
          // The last error is kept after later successes; it only matters when it is newer than the last success.
          const failing = Boolean(state?.last_error_at && (!state.last_ok_at || state.last_error_at > state.last_ok_at))
          return `${job.label} ${ran}${failing ? " (its last run failed)" : ""}`
        }).join("; ")}.
      </Text>
      <Text size="small">
        Catalog feed: {published.length
          ? published.map((build) => `${PLATFORM[build.platform] ?? build.platform} ${count(build.item_count)} items, published ${ago(build.published_at, now)}, last fetched ${ago(health.feed?.last_fetch?.[build.platform]?.fetched_at, now)}`).join("; ")
          : "nothing published yet"}.
      </Text>
      <Link className="text-ui-fg-interactive text-sm" to="/tracking/health">Open Tracking health for errors and retries</Link>
    </div>
  )
}

function Report({ report }: { report: ReportPayload }) {
  const data: SparkDatum[] = report.days.map((day) => ({
    label: dayLabel(day.day),
    values: { sessions: day.sessions, product_views: day.product_views, add_to_cart: day.add_to_cart, purchases: day.purchases },
  }))
  const t = report.totals
  const totals = [
    ["Visitors", count(t.visitors)], ["Sessions", count(t.sessions)], ["Page views", count(t.page_views)],
    ["Product views", count(t.product_views)], ["Add to cart", count(t.add_to_cart)], ["Checkouts started", count(t.initiate_checkout)],
    ["Web orders", count(t.purchases)], ["Web order value", taka(t.revenue)],
  ]
  return (
    <div className="flex flex-col gap-y-4">
      <Container className="space-y-3">
        <Heading level="h2">{dayLabel(report.from_day)} to {dayLabel(report.to_day)}</Heading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {totals.map(([label, value]) => <div key={label} className="rounded-lg border border-ui-border-base p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">{label}</Text>
            <Text size="large" weight="plus" className="tabular-nums">{value}</Text>
          </div>)}
        </div>
        <LiveSpark data={data} series={REPORT_SERIES} caption="Sessions, product views, add to cart and web orders per day" />
        {report.errors.length ? <Alert variant="warning">Some parts could not be read: {report.errors.join("; ")}.</Alert> : null}
      </Container>
      <Container className="space-y-3">
        <Heading level="h2">Funnel</Heading>
        <Funnel funnel={report.funnel} />
      </Container>
      <Container className="space-y-3">
        <Heading level="h2">By day</Heading>
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Day</Table.HeaderCell>
                {["Visitors", "Sessions", "Page views", "Product views", "Add to cart", "Checkouts", "Web orders", "Value"].map((label) =>
                  <Table.HeaderCell key={label} className="text-right">{label}</Table.HeaderCell>)}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {[...report.days].reverse().map((day) => <Table.Row key={day.day}>
                <Table.Cell>{dayLabel(day.day)}</Table.Cell>
                {[day.visitors, day.sessions, day.page_views, day.product_views, day.add_to_cart, day.initiate_checkout, day.purchases].map((n, i) =>
                  <Table.Cell key={i} className="text-right tabular-nums">{count(n)}</Table.Cell>)}
                <Table.Cell className="text-right tabular-nums">{taka(day.revenue)}</Table.Cell>
              </Table.Row>)}
            </Table.Body>
          </Table>
        </div>
      </Container>
      <Container className="grid gap-6 xl:grid-cols-2">
        <DimTable limit={25} title="Sources" keyLabel="Source" rows={report.tables.sources} columns={SESSION_COLUMNS} empty="No visits recorded." />
        <DimTable limit={25} title="Landing pages" keyLabel="Page" rows={report.tables.landing} columns={SESSION_COLUMNS} empty="No landing pages recorded." />
        <DimTable limit={25} title="Products" keyLabel="Product" rows={report.tables.products} columns={PRODUCT_COLUMNS} empty="No product activity recorded." />
        <DimTable limit={25} title="Phone models" keyLabel="Model" rows={report.tables.devices} columns={PRODUCT_COLUMNS} empty="No model activity recorded." />
        <DimTable limit={25} title="Case types" keyLabel="Case type" rows={report.tables.case_types} columns={PRODUCT_COLUMNS} empty="No case type activity recorded." />
        <DimTable limit={25} title="Women / Men" keyLabel="Audience" rows={report.tables.audiences} columns={SESSION_COLUMNS} empty="No audience recorded." />
        <DimTable limit={25} title="Devices" keyLabel="Device" rows={report.tables.device_classes} columns={SESSION_COLUMNS} empty="No devices recorded." />
      </Container>
    </div>
  )
}

function StaffLinks({ links, error }: { links: StaffLink[] | null; error: string }) {
  return (
    <Container className="space-y-3">
      <Heading level="h2">Exclude this browser</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Staff who order through the website: open the link for each shop address once, on every phone or computer
        you use to shop (in the same browser). That browser then loads no ad pixels, sends nothing to Meta, TikTok or
        Google, and its visits and orders are marked Staff here and left out of every number.
      </Text>
      {error ? <Alert variant="warning">{error}</Alert> : null}
      {links === null && !error ? <Text size="small">Loading the links...</Text> : null}
      {links?.length ? <div className="space-y-2">
        {links.map((link) => <div key={link.host} className="flex flex-wrap items-center gap-3 rounded-lg border border-ui-border-base p-3">
          <div className="min-w-[12rem] flex-1">
            <Text size="small" weight="plus">{link.host}</Text>
            <Text size="xsmall" className="text-ui-fg-muted">{link.list === "live" ? "Live shop address" : "Test shop address"}</Text>
          </div>
          <a className="text-ui-fg-interactive text-sm" href={link.url} target="_blank" rel="noreferrer">Exclude this browser</a>
          <span className="flex items-center gap-1 text-sm text-ui-fg-subtle">Copy link <Copy content={link.url} /></span>
          <a className="text-ui-fg-subtle text-sm" href={link.off_url} target="_blank" rel="noreferrer">Undo</a>
        </div>)}
      </div> : null}
      <Text size="xsmall" className="text-ui-fg-muted">
        The links stop working when TRACKING_INGEST_SECRET changes; open the new ones then.
      </Text>
    </Container>
  )
}

function Definitions() {
  return (
    <Container className="space-y-2">
      <Heading level="h2">What these numbers mean</Heading>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ui-fg-subtle">
        <li>Visitors count browsers with JavaScript running that are not bots; ad-blocked visitors appear only through the server Purchase. There are no heartbeats: "on the shop now" is anyone who did something in the last 5 minutes.</li>
        <li>Today runs from midnight in Dhaka to now; yesterday is the same span of yesterday. The top numbers include the last minute; the tables and the funnel update once a minute.</li>
        <li>Product views count product pages opened; switching model or case on the page is not another view.</li>
        <li>Web orders are checkouts on the website that tracking recorded, with their value including delivery.</li>
        <li>All orders counts every order placed today except drafts and orders imported from florayn.com, whichever shop address it came from. Cancelled orders are counted but add no revenue; the average order is revenue divided by the orders not cancelled.</li>
        <li>Pace divides today's orders by the share of the last 7 days' orders that had been placed by this time of day.</li>
        <li>The funnel shows how many of today's sessions reached each step, each step as a share of the one before.</li>
        <li>Browsers marked with "Exclude this browser" are never counted; their activity shows as Staff under recent activity.</li>
      </ul>
    </Container>
  )
}

const LivePage = () => {
  const [host, setHost] = useState("")
  const [tab, setTab] = useState<Tab>("today")
  const [live, setLive] = useState<LivePayload | null>(null)
  const [error, setError] = useState("")
  const [report, setReport] = useState<{ key: string; data: ReportPayload } | null>(null)
  const [reportError, setReportError] = useState("")
  const [reportBusy, setReportBusy] = useState(false)
  const [links, setLinks] = useState<StaffLink[] | null>(null)
  const [linkError, setLinkError] = useState("")
  const latest = useRef(0)

  const load = useCallback(async () => {
    const id = ++latest.current
    const data = await getJson<LivePayload>(`/admin/tracking/live${host ? `?host=${encodeURIComponent(host)}` : ""}`)
    if (id !== latest.current) return
    setLive(data)
    setError("")
  }, [host])

  const refresh = useCallback(() => {
    void load().catch((e: Error) => setError(e.message))
  }, [load])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll only while this tab is visible and on Today; catch up at once when it becomes visible again.
  const pollMs = Math.max(10, live?.poll_seconds ?? 15) * 1000
  useEffect(() => {
    if (tab !== "today") return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (!timer) timer = setInterval(refresh, pollMs)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh()
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
  }, [refresh, pollMs, tab])

  const loadReport = useCallback(async (range: "7d" | "30d") => {
    const key = `${range}|${host}`
    setReportBusy(true)
    setReportError("")
    try {
      const data = await getJson<ReportPayload>(`/admin/tracking/report?range=${range}${host ? `&host=${encodeURIComponent(host)}` : ""}`)
      setReport({ key, data })
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Could not load the report.")
    } finally {
      setReportBusy(false)
    }
  }, [host])

  useEffect(() => {
    if (tab !== "today") void loadReport(tab)
  }, [tab, loadReport])

  useEffect(() => {
    getJson<{ links: StaffLink[] }>("/admin/tracking/staff-link")
      .then((data) => setLinks(data.links))
      .catch((e: Error) => setLinkError(e.message))
  }, [])

  if (!live) {
    return <Container className="space-y-3">
      {error ? <>
        <Text role="alert">{error}</Text>
        <Button variant="secondary" onClick={refresh}>Try again</Button>
      </> : <Text>Loading the live numbers...</Text>}
    </Container>
  }

  const now = live.now
  const today = live.today
  const sparkData: SparkDatum[] = live.spark.map((point) => ({
    label: point.t.slice(11, 16),
    values: { pv: point.pv, vc: point.vc, atc: point.atc, ic: point.ic, p: point.p },
  }))
  const selected = host || filterValue(live.filter.key)
  const currentReport = tab !== "today" && report?.key === `${tab}|${host}` ? report.data : null

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Heading>Live</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Updated {new Date(live.generated_at).toLocaleTimeString()}; refreshes every {live.poll_seconds} seconds while this tab is open.{" "}
              <Link className="text-ui-fg-interactive" to="/tracking">Tracking settings</Link>
            </Text>
          </div>
          <div className="w-56">
            <Select value={selected} onValueChange={(value) => setHost(value)}>
              <Select.Trigger aria-label="Shop address"><Select.Value /></Select.Trigger>
              <Select.Content>
                {live.filter.options.map((option) => <Select.Item key={option.value} value={option.value}>{option.label}</Select.Item>)}
              </Select.Content>
            </Select>
          </div>
        </div>
        {error ? <Text size="small" className="text-ui-fg-error">{error} Showing the last numbers.</Text> : null}
        {live.errors.length ? <Alert variant="warning">Some parts could not be read: {live.errors.join("; ")}.</Alert> : null}
      </Container>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <Tabs.List>
          <Tabs.Trigger value="today">Today</Tabs.Trigger>
          <Tabs.Trigger value="7d">Last 7 days</Tabs.Trigger>
          <Tabs.Trigger value="30d">Last 30 days</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="today" className="mt-4 flex flex-col gap-y-4">
          <Container className="space-y-3">
            <Heading level="h2">Right now</Heading>
            <div className="flex flex-wrap items-end gap-8">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">On the shop now (last 5 minutes)</Text>
                <Text className="text-4xl font-semibold tabular-nums">{count(now.visitors_5m)}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Last 30 minutes</Text>
                <Text size="xlarge" weight="plus" className="tabular-nums">{count(now.visitors_30m)}</Text>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Text size="small" weight="plus">Where they came from (30 min)</Text>
                {now.by_source.length ? <div className="flex flex-wrap gap-2">
                  {now.by_source.map((row) => <Badge key={row.source} color="grey">{row.label}: {count(row.visitors)}</Badge>)}
                </div> : <Text size="small" className="text-ui-fg-subtle">Nobody in the last 30 minutes.</Text>}
              </div>
              <div className="space-y-1">
                <Text size="small" weight="plus">Pages they are on (30 min)</Text>
                {now.top_pages.length ? <ul className="space-y-0.5">
                  {now.top_pages.map((page) => <li key={page.path} className="flex justify-between gap-3 text-sm">
                    <span className="truncate">{page.path}</span><span className="tabular-nums text-ui-fg-subtle">{count(page.visitors)}</span>
                  </li>)}
                </ul> : <Text size="small" className="text-ui-fg-subtle">No page views in the last 30 minutes.</Text>}
              </div>
            </div>
          </Container>

          <Container className="space-y-3">
            <Heading level="h2">Today so far, against yesterday at this time</Heading>
            <Cards today={today} yesterday={live.yesterday_same_time} />
          </Container>

          <Container className="space-y-3">
            <Heading level="h2">Orders against the daily target</Heading>
            <Target today={today} />
          </Container>

          <Container className="space-y-3">
            <Heading level="h2">Today, every 5 minutes</Heading>
            <LiveSpark data={sparkData} series={SPARK_SERIES} caption="Page views, product views, add to cart, checkouts and web orders per 5 minutes today" />
          </Container>

          <Container className="space-y-3">
            <Heading level="h2">Funnel</Heading>
            <Funnel funnel={live.funnel} />
          </Container>

          <Container className="grid gap-6 xl:grid-cols-2">
            <DimTable title="Sources" keyLabel="Source" rows={live.tables.sources} columns={SESSION_COLUMNS} empty="No visits yet today." />
            <DimTable title="Products" keyLabel="Product" rows={live.tables.products} columns={PRODUCT_COLUMNS} empty="No product views yet today." />
            <DimTable title="Phone models" keyLabel="Model" rows={live.tables.devices} columns={PRODUCT_COLUMNS} empty="No model activity yet today." />
            <DimTable title="Case types" keyLabel="Case type" rows={live.tables.case_types} columns={PRODUCT_COLUMNS} empty="No case type activity yet today." />
          </Container>

          <Container className="space-y-3">
            <Heading level="h2">Recent activity</Heading>
            <RecentTable rows={live.recent} />
          </Container>

          <Container className="space-y-3">
            <Heading level="h2">Tracking health</Heading>
            <Health live={live} />
          </Container>
        </Tabs.Content>

        {(["7d", "30d"] as const).map((range) => <Tabs.Content key={range} value={range} className="mt-4 flex flex-col gap-y-4">
          <div className="flex items-center gap-3">
            <Button size="small" variant="secondary" isLoading={reportBusy} disabled={reportBusy} onClick={() => void loadReport(range)}>Refresh</Button>
            <Text size="xsmall" className="text-ui-fg-muted">Daily totals up to the last rollup; refreshed at most every 5 minutes.</Text>
          </div>
          {reportError ? <Alert variant="error">{reportError}</Alert> : null}
          {currentReport ? <Report report={currentReport} /> : !reportError ? <Container><Text>Loading the report...</Text></Container> : null}
        </Tabs.Content>)}
      </Tabs>

      <Definitions />
      <StaffLinks links={links} error={linkError} />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Live",
  icon: ChartActivity,
})

export default LivePage
