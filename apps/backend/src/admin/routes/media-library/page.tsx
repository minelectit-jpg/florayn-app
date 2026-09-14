import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

type DesignFolder = {
  slug: string
  caseTypes: string[]
  images: number
  sample: string | null
}
type DesignDetail = {
  design: string
  caseTypes: Record<string, Record<string, string[]>>
}

async function api(path: string) {
  const res = await fetch(path, { credentials: "include" })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`)
  return body
}

const MediaLibraryPage = () => {
  const [designs, setDesigns] = useState<DesignFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<DesignDetail | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    api("/admin/media-library")
      .then((d) => setDesigns(d.designs ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function openDesign(slug: string) {
    setOpening(slug)
    try {
      const d = await api(`/admin/media-library?design=${encodeURIComponent(slug)}`)
      setOpen(d)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setOpening(null)
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? designs.filter((d) => d.slug.toLowerCase().includes(needle))
      : designs
  }, [designs, q])

  // ---- Inside one design: case type -> device -> images ----
  if (open) {
    return (
      <Container className="p-0">
        <div className="flex items-center gap-3 px-6 py-4">
          <Button variant="secondary" size="small" onClick={() => setOpen(null)}>
            &larr; Library
          </Button>
          <Heading level="h2">{open.design}</Heading>
        </div>
        <div className="divide-y">
          {Object.entries(open.caseTypes).map(([ct, devices]) => (
            <div key={ct} className="px-6 py-4">
              <Text size="small" weight="plus" className="mb-3 capitalize">
                {ct.replace(/-/g, " ")}
              </Text>
              <div className="space-y-4">
                {Object.entries(devices).map(([device, urls]) => (
                  <div key={device}>
                    <Text size="xsmall" className="mb-1 text-ui-fg-muted">
                      {device.replace(/-/g, " ")} &middot; {urls.length}
                    </Text>
                    <div className="flex flex-wrap gap-2">
                      {urls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block size-20 overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-subtle"
                        >
                          <img
                            src={url}
                            alt={device}
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Container>
    )
  }

  // ---- Top level: design folders ----
  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Media library</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Every render in storage, folder by folder: design &rarr; case type
          &rarr; device. Click a design to browse its images. {designs.length}{" "}
          designs.
        </Text>
      </div>
      <div className="px-6 py-3">
        <Input
          placeholder="Search designs&hellip;"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <div className="px-6 py-4">
        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((d) => (
              <button
                key={d.slug}
                type="button"
                onClick={() => openDesign(d.slug)}
                disabled={opening === d.slug}
                className="group overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-subtle text-left transition-colors hover:border-ui-border-interactive"
              >
                <div className="aspect-square overflow-hidden bg-ui-bg-base">
                  {d.sample ? (
                    <img
                      src={d.sample}
                      alt={d.slug}
                      loading="lazy"
                      className="size-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="p-2">
                  <Text size="xsmall" weight="plus" className="truncate capitalize">
                    {d.slug.replace(/-/g, " ")}
                  </Text>
                  <div className="mt-1 flex items-center gap-1">
                    <Badge size="2xsmall" color="grey">
                      {d.images} imgs
                    </Badge>
                    <Badge size="2xsmall" color="grey">
                      {d.caseTypes.length} types
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Media library",
  icon: Photo,
})

export default MediaLibraryPage
