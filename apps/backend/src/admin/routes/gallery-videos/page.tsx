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
  position: number
}

type Design = {
  slug: string
  name: string
  live?: boolean
  /** Case-type slugs this design is offered in. */
  caseTypes?: string[]
}
type CaseTypeRec = { slug: string; name: string }

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
  const [caseTypeRecs, setCaseTypeRecs] = useState<CaseTypeRec[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pickerFor, setPickerFor] = useState<"video" | "poster" | null>(null)

  const [designSlug, setDesignSlug] = useState("")
  const [caseType, setCaseType] = useState("")
  const [videoUrl, setVideoUrl] = useState("")
  const [posterUrl, setPosterUrl] = useState("")
  const [position, setPosition] = useState("1")
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
          setCaseTypeRecs(
            (d.case_types ?? []).map((c: any) => ({
              slug: c.slug,
              name: c.name,
            }))
          )
        )
        .catch(() => undefined),
    ]).finally(() => setLoading(false))
  }, [])

  const designName = (slug: string) =>
    designs.find((d) => d.slug === slug)?.name ?? slug

  // Only the case types the selected design is actually offered in.
  const availableCaseTypes = useMemo(() => {
    const design = designs.find((d) => d.slug === designSlug)
    const allNames = caseTypeRecs.map((c) => c.name)
    if (!design?.caseTypes?.length) return allNames
    const nameBySlug = new Map(caseTypeRecs.map((c) => [c.slug, c.name]))
    return design.caseTypes
      .map((s) => nameBySlug.get(s))
      .filter((n): n is string => Boolean(n))
  }, [designs, designSlug, caseTypeRecs])

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
          poster_url: posterUrl.trim(),
          position: Number(position) || 1,
        }),
      })
      setVideos(res.videos ?? [])
      setVideoUrl("")
      setPosterUrl("")
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
                  onClick={() => {
                    setDesignSlug(d.slug)
                    setCaseType("")
                  }}
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
              <Select
                value={caseType}
                onValueChange={setCaseType}
                disabled={!designSlug}
              >
                <Select.Trigger>
                  <Select.Value
                    placeholder={
                      designSlug ? "Choose a case type" : "Pick a design first"
                    }
                  />
                </Select.Trigger>
                <Select.Content>
                  {availableCaseTypes.map((n) => (
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
                  onClick={() => setPickerFor("video")}
                >
                  Choose
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label size="xsmall" weight="plus">
                  Position in gallery
                </Label>
                <Input
                  type="number"
                  min={1}
                  className="w-24"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Label size="xsmall" weight="plus">
                  Thumbnail (optional — else the video&rsquo;s first frame)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Thumbnail image URL"
                    value={posterUrl}
                    onChange={(e) => setPosterUrl(e.target.value)}
                  />
                  <Button
                    size="small"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => setPickerFor("poster")}
                  >
                    Choose
                  </Button>
                </div>
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
                  {v.poster_url ? (
                    <img src={v.poster_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <video src={v.video_url} muted className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Text size="small" weight="plus">
                    {designName(v.design_slug)}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {v.case_type} · {v.design_slug} · slot {v.position ?? 1}
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
        open={pickerFor !== null}
        onOpenChange={(o) => {
          if (!o) setPickerFor(null)
        }}
        accept={pickerFor === "poster" ? "image" : "video"}
        title={pickerFor === "poster" ? "Choose a thumbnail" : "Choose a video"}
        onSelect={(url) =>
          pickerFor === "poster" ? setPosterUrl(url) : setVideoUrl(url)
        }
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Gallery videos",
  icon: PlaySolid,
})

export default GalleryVideosPage
