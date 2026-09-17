import { defineRouteConfig } from "@medusajs/admin-sdk"
import { PlaySolid } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  IconButton,
  Input,
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

  const matchingDesigns = useMemo(() => {
    const q = designQuery.trim().toLowerCase()
    const list = q
      ? designs.filter(
          (d) =>
            d.name.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q)
        )
      : designs
    return list.slice(0, 40)
  }, [designs, designQuery])

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
      <div className="flex flex-col gap-3 px-6 py-4">
        <Text size="small" weight="plus">
          Add / replace a video
        </Text>
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-64">
            <Input
              placeholder="Search designs…"
              value={designQuery}
              onChange={(e) => setDesignQuery(e.target.value)}
            />
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-ui-border-base">
              {matchingDesigns.map((d) => (
                <button
                  key={d.slug}
                  type="button"
                  onClick={() => setDesignSlug(d.slug)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                    designSlug === d.slug
                      ? "bg-ui-bg-base-pressed font-medium"
                      : "hover:bg-ui-bg-subtle"
                  }`}
                >
                  <span>{d.name}</span>
                  {d.live === false ? (
                    <span className="text-ui-fg-muted text-xs">not live</span>
                  ) : null}
                </button>
              ))}
              {matchingDesigns.length === 0 ? (
                <Text size="xsmall" className="text-ui-fg-muted px-3 py-2">
                  No match.
                </Text>
              ) : null}
            </div>
          </div>

          <select
            value={caseType}
            onChange={(e) => setCaseType(e.target.value)}
            className="bg-ui-bg-field border-ui-border-base h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Case type…</option>
            {caseTypes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Video URL"
              className="w-64"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
            />
            <Button
              size="small"
              variant="secondary"
              onClick={() => setPicker(true)}
            >
              Choose
            </Button>
          </div>

          <Button variant="primary" isLoading={busy} onClick={addVideo}>
            Save video
          </Button>
        </div>
        {designSlug ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            Selected: <b>{designName(designSlug)}</b>
            {caseType ? ` · ${caseType}` : ""}
          </Text>
        ) : null}
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
