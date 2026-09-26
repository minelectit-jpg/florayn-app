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
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import type { CatalogAdminView } from "../../../../api/admin/tracking/catalog/route"
import type { FeedMeta, FeedWarning } from "../../../../lib/tracking/catalog-feed"
import type { ImageMode, TrackingConfig } from "../../../../lib/tracking/settings"

/**
 * Admin > Tracking > Catalog (TRACKING.md 3.5, 8): the Meta and TikTok
 * catalog feed. Settings are saved through /admin/tracking/settings (the
 * catalog section only); everything else - feed URLs, builds, fetches, image
 * copies, the variant index - comes from /admin/tracking/catalog. A sub-page
 * of Tracking, so it has no sidebar entry of its own.
 */

type Catalog = TrackingConfig["catalog"]
type Action = "rebuild" | "publish_anyway" | "rotate_token" | "convert_images"

const IMAGE_MODES: { value: ImageMode; label: string }[] = [
  { value: "jpeg_copies", label: "JPEG copies in R2 (needs sharp on the server)" },
  { value: "cf_transform", label: "Cloudflare converts on the fly (needs Image Transformations)" },
]

const WARNING_LABELS: Record<FeedWarning["kind"], string> = {
  no_image: "Left out: no ready image yet",
  price_mismatch: "Left out: price differs from the case type price",
  empty: "The feed has no items",
}

function when(value: string | null | undefined): string {
  if (!value) return "never"
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? "never" : time.toLocaleString()
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function statusColor(status: string | undefined): "green" | "orange" | "grey" | "blue" {
  if (status === "published") return "green"
  if (status === "held") return "orange"
  if (status === "unchanged") return "blue"
  return "grey"
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const errors = Array.isArray(data.errors) ? data.errors.join(" ") : ""
    throw new Error(errors || data.message || "The server did not accept that.")
  }
  return data
}

const CatalogPage = () => {
  const prompt = usePrompt()
  const [data, setData] = useState<CatalogAdminView | null>(null)
  const [form, setForm] = useState<Catalog | null>(null)
  const [guard, setGuard] = useState("")
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState("")
  const [reload, setReload] = useState(0)

  function accept(payload: CatalogAdminView, keepEdits: boolean) {
    setData(payload)
    if (!keepEdits) {
      setForm(payload.catalog)
      setGuard(String(payload.catalog.shrink_guard_pct))
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoadError("")
    fetch("/admin/tracking/catalog", { credentials: "include", signal: controller.signal })
      .then(readJson)
      .then((payload: CatalogAdminView) => accept(payload, form !== null))
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message || "Could not load the catalog feed.")
      })
    // `form` is read only to keep unsaved edits when the page refreshes itself.
    return () => controller.abort()
  }, [reload])

  // While a rebuild or a conversion runs on the server, check back every 10 s.
  const running = Boolean(data?.running.rebuild || data?.running.convert)
  useEffect(() => {
    if (!running) return
    const timer = setTimeout(() => setReload((value) => value + 1), 10_000)
    return () => clearTimeout(timer)
  }, [running, data])

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault()
    if (!form || busy) return
    setBusy("save")
    try {
      await readJson(await fetch("/admin/tracking/settings", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalog: { ...form, shrink_guard_pct: guard.trim() === "" ? Number.NaN : Number(guard) } }),
      }))
      toast.success("Catalog settings saved")
      setForm(null)
      setReload((value) => value + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the catalog settings.")
    } finally {
      setBusy("")
    }
  }

  async function act(action: Action) {
    if (action === "rotate_token") {
      const ok = await prompt({
        title: "Make a new feed token?",
        description: "The current feed URLs stop working at once. Paste the new URLs into Meta Commerce Manager and TikTok Catalog Manager straight after.",
        confirmText: "Make a new token",
        cancelText: "Cancel",
      })
      if (!ok) return
    }
    if (action === "publish_anyway") {
      const ok = await prompt({
        title: "Publish the held build?",
        description: "It has far fewer items than the published feed. Publish it only if the missing items really should leave your ads.",
        confirmText: "Publish anyway",
        cancelText: "Cancel",
      })
      if (!ok) return
    }
    setBusy(action)
    try {
      const payload = await readJson(await fetch("/admin/tracking/catalog", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }))
      accept(payload, true)
      toast.success(payload.message ?? "Done")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reach the server.")
    } finally {
      setBusy("")
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied")
    } catch {
      toast.error("Could not copy; select the address and copy it by hand.")
    }
  }

  function toggleSlug(key: "include_case_types" | "exclude_case_types", slug: string, on: boolean) {
    setForm((current) => {
      if (!current) return current
      const list = current[key].filter((value) => value !== slug)
      return { ...current, [key]: on ? [...list, slug] : list }
    })
  }

  if (loadError) {
    return <Container className="space-y-4">
      <Text role="alert">{loadError}</Text>
      <Button variant="secondary" onClick={() => setReload((value) => value + 1)}>Try again</Button>
    </Container>
  }
  if (!data || !form) return <Container><Text>Loading the catalog feed...</Text></Container>

  const saved = data.catalog
  const meta = data.builds.meta
  const tiktok = data.builds.tiktok
  const held = meta.candidate?.status === "held"
  const images = data.images
  const imageRun = images.last_run
  const needed = imageRun?.needed ?? 0
  // An alert stays open until a later build was published or finished without being held.
  const clearedAt = Math.max(Date.parse(meta.published?.published_at ?? "") || 0,
    data.last_build && data.last_build.status !== "held" ? Date.parse(data.last_build.at) || 0 : 0)
  const alert = data.alert && Date.parse(data.alert.at) > clearedAt ? data.alert : null
  const buildRow = (label: string, build: FeedMeta | null) => <div className="flex flex-wrap items-center gap-2">
    <Text size="small" weight="plus" className="w-24">{label}</Text>
    {build ? <>
      <Badge size="2xsmall" color={statusColor(build.status)}>{build.status}</Badge>
      <Text size="small">{build.item_count} items, {size(build.bytes)} gzip</Text>
      <Text size="small" className="text-ui-fg-muted">built {when(build.built_at)}{build.published_at ? `, published ${when(build.published_at)}` : ""}</Text>
    </> : <Text size="small" className="text-ui-fg-muted">none yet</Text>}
  </div>

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="space-y-3">
        <div className="space-y-1">
          <Heading>Catalog feed</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            The product list Meta and TikTok read for catalog ads: one item per sellable variant, with the same ids
            the shop sends in its events. Built from the shop every time products or stock change, and at 03:30
            Dhaka every day.
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color={saved.enabled ? "green" : "grey"}>Feed {saved.enabled ? "on" : "off"}</Badge>
          <Badge color={statusColor(meta.published?.status)}>
            {meta.published ? `${meta.published.item_count} items published` : "Nothing published yet"}
          </Badge>
          {saved.exclude_case_types.length ? <Badge color="grey">Leaves out: {saved.exclude_case_types.join(", ")}</Badge> : null}
        </div>
        <Link className="text-ui-fg-interactive text-sm" to="/tracking">Back to Tracking</Link>
        {alert ? <Alert variant={alert.kind === "feed_error" ? "error" : "warning"}>
          {alert.kind === "feed_error" ? "The last build failed" : "A build was held"} ({when(alert.at)}): {alert.detail ?? ""}
        </Alert> : null}
      </Container>

      <form onSubmit={saveSettings}>
        <fieldset disabled={busy === "save"}>
          <Container className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Heading level="h2">Settings</Heading>
              <Switch id="catalog_enabled" checked={form.enabled} onCheckedChange={(on) => setForm({ ...form, enabled: on })} />
              <Label htmlFor="catalog_enabled" size="small">Build and publish the feed</Label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="catalog_base_url" size="small">Shop address for item links</Label>
                <Input id="catalog_base_url" value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} />
                <Text size="xsmall" className="text-ui-fg-muted">https://new.florayn.com until cutover, then https://florayn.com. No slash at the end.</Text>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="catalog_image_base_url" size="small">Image address</Label>
                <Input id="catalog_image_base_url" value={form.image_base_url} onChange={(event) => setForm({ ...form, image_base_url: event.target.value })} />
                <Text size="xsmall" className="text-ui-fg-muted">The R2 custom domain, https://img.florayn.com.</Text>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="catalog_image_mode" size="small">Feed images</Label>
                <Select value={form.image_mode} onValueChange={(value) => setForm({ ...form, image_mode: value as ImageMode })}>
                  <Select.Trigger id="catalog_image_mode"><Select.Value /></Select.Trigger>
                  <Select.Content>{IMAGE_MODES.map((mode) =>
                    <Select.Item key={mode.value} value={mode.value}>{mode.label}</Select.Item>)}</Select.Content>
                </Select>
                <Text size="xsmall" className="text-ui-fg-muted">Meta needs JPEG or PNG; the renders are WebP.</Text>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="catalog_guard" size="small">Hold a build that shrinks by more than (%)</Label>
                <Input id="catalog_guard" inputMode="numeric" value={guard} onChange={(event) => setGuard(event.target.value)} />
                <Text size="xsmall" className="text-ui-fg-muted">5 to 50. A held build waits here for "Publish anyway" and sends an alert email.</Text>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Text size="small" weight="plus">Leave these case types out</Text>
                {data.case_types.map((ct) => <div key={ct.slug} className="flex items-center gap-2">
                  <Checkbox id={`exclude_${ct.slug}`} checked={form.exclude_case_types.includes(ct.slug)}
                    onCheckedChange={(value) => toggleSlug("exclude_case_types", ct.slug, value === true)} />
                  <Label htmlFor={`exclude_${ct.slug}`} size="small">{ct.name}{ct.is_active ? "" : " (inactive)"}</Label>
                </div>)}
                <Text size="xsmall" className="text-ui-fg-muted">Alcantara stays out until its per-model prices are confirmed to match checkout.</Text>
              </div>
              <div className="grid gap-2">
                <Text size="small" weight="plus">Only these case types (optional)</Text>
                {data.case_types.map((ct) => <div key={ct.slug} className="flex items-center gap-2">
                  <Checkbox id={`include_${ct.slug}`} checked={form.include_case_types.includes(ct.slug)}
                    onCheckedChange={(value) => toggleSlug("include_case_types", ct.slug, value === true)} />
                  <Label htmlFor={`include_${ct.slug}`} size="small">{ct.name}</Label>
                </div>)}
                <Text size="xsmall" className="text-ui-fg-muted">None ticked means every case type that is not left out. Regular products are always included.</Text>
              </div>
            </div>
            <Button type="submit" isLoading={busy === "save"} disabled={Boolean(busy)}>Save catalog settings</Button>
          </Container>
        </fieldset>
      </form>

      <Container className="space-y-3">
        <Heading level="h2">Feed addresses</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Paste these into Meta Commerce Manager (Data sources, scheduled feed) and TikTok Catalog Manager. Anyone with
          the address can read the feed, so share it only there.
        </Text>
        {([
          ["Meta", data.feed_urls.meta], ["Meta (gzip file)", data.feed_urls.meta_gz],
          ["TikTok", data.feed_urls.tiktok], ["TikTok (gzip file)", data.feed_urls.tiktok_gz],
        ] as const).map(([label, url]) => <div key={label} className="grid gap-1">
          <Label size="small">{label}</Label>
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(event) => event.target.select()} />
            <Button type="button" variant="secondary" size="small" onClick={() => void copy(url)}>Copy</Button>
          </div>
        </div>)}
        <div>
          <Button type="button" variant="secondary" size="small" isLoading={busy === "rotate_token"} disabled={Boolean(busy)}
            onClick={() => void act("rotate_token")}>Rotate token</Button>
        </div>
      </Container>

      <Container className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Heading level="h2">Builds</Heading>
          <Button type="button" variant="secondary" size="small" isLoading={busy === "rebuild" || data.running.rebuild}
            disabled={Boolean(busy) || data.running.rebuild} onClick={() => void act("rebuild")}>Rebuild now</Button>
        </div>
        {buildRow("Published", meta.published)}
        {buildRow("Last build", meta.candidate)}
        {tiktok.published && tiktok.published.content_hash !== meta.published?.content_hash
          ? <Text size="small" className="text-ui-fg-muted">The TikTok file is from a different build than Meta&apos;s.</Text> : null}
        {data.last_build ? <Text size="small" className="text-ui-fg-muted">Last checked {when(data.last_build.at)}: {data.last_build.status}.</Text> : null}
        {held ? <Alert variant="warning">
          <div className="space-y-2">
            <Text size="small">
              The last build has {meta.candidate?.item_count ?? 0} items against {meta.published?.item_count ?? 0} published,
              so it was held. Nothing changed for Meta and TikTok.
            </Text>
            <Button type="button" size="small" isLoading={busy === "publish_anyway"} disabled={Boolean(busy)}
              onClick={() => void act("publish_anyway")}>Publish anyway</Button>
          </div>
        </Alert> : null}
        {(meta.candidate?.warnings ?? []).length ? <div className="space-y-2">
          <Text size="small" weight="plus">Warnings in the last build</Text>
          {(meta.candidate?.warnings ?? []).map((warning) => <div key={warning.kind} className="space-y-1">
            <Text size="small">{WARNING_LABELS[warning.kind] ?? warning.kind}: {warning.count}</Text>
            {warning.examples.length ? <ul className="list-disc pl-5">
              {warning.examples.map((example) => <li key={example}><Text size="xsmall" className="text-ui-fg-muted">{example}</Text></li>)}
            </ul> : null}
          </div>)}
        </div> : null}
        {data.last_admin_run ? <Text size="small" className="text-ui-fg-muted">
          {data.last_admin_run.action === "rebuild" ? "Rebuild" : "Image conversion"} started {when(data.last_admin_run.started_at)}:{" "}
          {data.last_admin_run.ok === null ? "still running" : data.last_admin_run.message}
        </Text> : null}
      </Container>

      <Container className="space-y-2">
        <Heading level="h2">Fetches</Heading>
        {(["meta", "tiktok"] as const).map((platform) => {
          const fetchRow = data.last_fetch[platform]
          return <Text key={platform} size="small">
            {platform === "meta" ? "Meta" : "TikTok"}: {fetchRow
              ? `${when(fetchRow.fetched_at)}, HTTP ${fetchRow.status}${fetchRow.bytes ? `, ${size(fetchRow.bytes)}` : ""}`
              : "not fetched yet"}
          </Text>
        })}
        <Text size="xsmall" className="text-ui-fg-muted">Only fetches with the right token are counted. An alert is sent when Meta has not fetched a published feed for 36 hours.</Text>
      </Container>

      <Container className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Heading level="h2">Images</Heading>
          <Button type="button" variant="secondary" size="small"
            isLoading={busy === "convert_images" || data.running.convert}
            disabled={Boolean(busy) || data.running.convert || saved.image_mode !== "jpeg_copies" || !images.sharp_installed}
            onClick={() => void act("convert_images")}>Convert images</Button>
        </div>
        {saved.image_mode === "jpeg_copies" ? <>
          {!images.sharp_installed ? <Alert variant="warning">
            sharp is not installed on the server, so JPEG copies cannot be made. Install it in apps/backend, or switch
            the feed images to Cloudflare conversion.
          </Alert> : <Badge color="green" size="2xsmall">sharp installed</Badge>}
          <Text size="small">
            {images.ready} JPEG copies ready{needed ? ` of ${needed} needed` : ""}; {images.failed} failed
            {imageRun ? `, ${imageRun.pending} still to do` : ""}.
          </Text>
          {imageRun ? <Text size="small" className="text-ui-fg-muted">
            Last run {when(imageRun.at)}: {imageRun.converted} converted, {imageRun.failed} failed
            {imageRun.last_error ? ` (last error: ${imageRun.last_error})` : ""}.
          </Text> : null}
          <Text size="xsmall" className="text-ui-fg-muted">
            The catalog job converts 150 images every 15 minutes by day and 600 at night (01:00 to 07:00 Dhaka). Items
            wait out of the feed until their first image is ready. Failed images are tried again after a day.
          </Text>
        </> : <Text size="small">Cloudflare converts each image when Meta or TikTok fetches it; nothing is stored.</Text>}
      </Container>

      <Container className="space-y-2">
        <Heading level="h2">Variant index</Heading>
        <Text size="small">
          {data.variant_index
            ? `${data.variant_index.sellable} of ${data.variant_index.count} variants sellable, built ${when(data.variant_index.built_at)}.`
            : "Not built yet. Until it is, events are counted but nothing is sent to ad platforms."}
        </Text>
        <Text size="small" className="text-ui-fg-muted">
          Catalog job: last run {when(data.job?.last_run_at)}, last success {when(data.job?.last_ok_at)}
          {data.job?.last_error ? `, last error: ${data.job.last_error}` : ""}.
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          The shop&apos;s own list of variant ids and prices. Event prices are taken from it, never from the browser.
        </Text>
      </Container>
    </div>
  )
}

export default CatalogPage
