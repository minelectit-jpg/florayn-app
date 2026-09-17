import { defineRouteConfig } from "@medusajs/admin-sdk"
import { PlaySolid } from "@medusajs/icons"
import {
  Button,
  Checkbox,
  Container,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

import MediaPicker from "../../components/media-picker"

type GalleryVideo = {
  id: string
  design_slug: string
  case_type: string
  video_url: string
  poster_url: string | null
}

type Design = { slug: string; name: string; live?: boolean }

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`)
  return body
}

const GalleryVideosPage = () => {
  const [videos, setVideos] = useState<GalleryVideo[]>([])
  const [designs, setDesigns] = useState<Design[]>([])
  const [caseTypes, setCaseTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [picker, setPicker] = useState(false)

  const [designSlug, setDesignSlug] = useState("")
  const [caseType, setCaseType] = useState("")
  const [videoUrl, setVideoUrl] = useState("")
  const [designQuery, setDesignQuery] = useState("")
  const [showAll, setShowAll] = useState(false)

  function loadVideos() {
    return api("/admin/content/gallery-videos")
      .then((d) => setVideos(d.videos ?? []))
      .catch((e) => toast.error(e.message))
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      loadVideos(),
      api("/admin/designs")
        .then((d) =>
          setDesigns(
            (d.designs ?? []).sort((a: Design, b: Design) =>
              a.name.localeCompare(b.name)
            )
          )
        )
        .catch(() => undefined),
      api("/admin/case-types")
        .then((d) =>
          setCaseTypes((d.case_types ?? []).map((c: any) => c.name).filter(Boolean))
        )
        .catch(() => undefined),
    ]).finally(() => setLoading(false))
  }, [])

  const designName = (slug: string) =>
    designs.find((d) => d.slug === slug)?.name ?? slug

  const liveCount = useMemo(
    () => designs.filter((d) => d.live).length,
    [designs]
  )

  const matchingDesigns = useMemo(() => {
    const q = designQuery.trim().toLowerCase()
    let list = showAll ? designs : designs.filter((d) => d.live)
    if (q) {
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)
      )
    }
    return list.slice(0, 80)
  }, [designs, designQuery, showAll])

  async function addVideo() {
    if (!designSlug || !caseType || !videoUrl.trim()) {
      toast.error("Pick a design, a case type and a video.")
      return
    }
    setBusy(true)
    try {
      const res = await api("/admin/content/gallery-videos", {
        method: "POST",
        body: JSON.stringify({
          design_slug: designSlug,
          case_type: caseType,
          video_url: videoUrl.trim(),
        }),
      })
      setVideos(res.videos ?? [])
      setVideoUrl("")
      toast.success("Saved.")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: GalleryVideo) {
    setBusy(true)
    try {
      const res = await api(`/admin/content/gallery-videos/${row.id}`, {
        method: "DELETE",
      })
      setVideos(res.videos ?? [])
      toast.success("Removed.")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function scan() {
    setScanning(true)
    try {
      const res = await api("/admin/content/gallery-videos/scan", {
        method: "POST",
      })
      setVideos(res.videos ?? [])
      toast.success(
        `Scan done — ${res.created} added, ${res.updated} updated${
          res.skipped ? `, ${res.skipped} skipped` : ""
        }.`
      )
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setScanning(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-start justify-between px-6 py-4">
        <div>
          <Heading level="h1">Gallery videos</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            A video for a design in one case type, shown in that product&rsquo;s
            gallery on every device. Add one below, or drop{" "}
            <b>&lt;design&gt;/&lt;case-type&gt;/video.mp4</b> in the File manager
            and press <b>Scan folders</b> to pull them all in.
          </Text>
        </div>
        <Button variant="secondary" isLoading={scanning} onClick={scan}>
          Scan folders
        </Button>
      </div>

      {/* Add form */}
      <div className="flex flex-col gap-4 px-6 py-4">
        <Text size="small" weight="plus">
          Add / replace a video
        </Text>

        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          {/* Design picker */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label size="xsmall" weight="plus">
                1. Design {designSlug ? `· ${designName(designSlug)}` : ""}
              </Label>
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="show-all"
                  checked={showAll}
                  onCheckedChange={(v) => setShowAll(!!v)}
                />
                <Label htmlFor="show-all" size="xsmall" className="text-ui-fg-muted">
                  Show all ({designs.length})
                </Label>
              </div>
            </div>
            <Input
              placeholder={`Search ${showAll ? designs.length : liveCount} designs…`}
              value={designQuery}
              onChange={(e) => setDesignQuery(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto rounded-lg border border-ui-border-base">
              {matchingDesigns.map((d) => (
                <button
                  key={d.slug}
                  type="button"
                  onClick={() => setDesignSlug(d.slug)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    designSlug === d.slug
                      ? "bg-ui-bg-base-pressed font-medium"
                      : "hover:bg-ui-bg-subtle"
                  }`}
                >
                  <span>{d.name}</span>
                  <span
                    className={`text-xs ${
                      d.live ? "text-ui-fg-interactive" : "text-ui-fg-muted"
                    }`}
                  >
                    {d.live ? "live" : "not live"}
                  </span>
                </button>
              ))}
              {matchingDesigns.length === 0 ? (
                <Text size="xsmall" className="text-ui-fg-muted px-3 py-3">
                  No match.
                </Text>
              ) : null}
            </div>
          </div>

          {/* Case type + video */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label size="xsmall" weight="plus">
                2. Case type
              </Label>
              <Select value={caseType} onValueChange={setCaseType}>
                <Select.Trigger>
                  <Select.Value placeholder="Choose a case type" />
                </Select.Trigger>
                <Select.Content>
                  {caseTypes.map((n) => (
                    <Select.Item key={n} value={n}>
                      {n}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label size="xsmall" weight="plus">
                3. Video
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Video URL"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <Button
                  size="small"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => setPicker(true)}
                >
                  Choose
                </Button>
              </div>
            </div>

            <Button
              variant="primary"
              isLoading={busy}
              disabled={!designSlug || !caseType || !videoUrl.trim()}
              onClick={addVideo}
            >
              Save video
            </Button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="px-6 py-4">
        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : videos.length === 0 ? (
          <Text size="small" className="text-ui-fg-muted">
            No gallery videos yet.
          </Text>
        ) : (
          <div className="flex flex-col gap-2">
            {videos.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-3 rounded-lg border border-ui-border-base p-2"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-ui-bg-subtle">
                  <video src={v.video_url} muted className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <Text size="small" weight="plus">
                    {designName(v.design_slug)}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {v.case_type} · {v.design_slug}
                  </Text>
                </div>
                <IconButton
                  size="small"
                  variant="transparent"
                  disabled={busy}
                  onClick={() => remove(v)}
                >
                  ✕
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <MediaPicker
        open={picker}
        onOpenChange={setPicker}
        accept="video"
        title="Choose a video"
        onSelect={(url) => setVideoUrl(url)}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Gallery videos",
  icon: PlaySolid,
})

export default GalleryVideosPage
