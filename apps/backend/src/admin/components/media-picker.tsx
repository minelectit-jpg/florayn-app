import { ArrowUpTray, Folder, Photo } from "@medusajs/icons"
import {
  Button,
  FocusModal,
  Heading,
  IconButton,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"

type Listing = {
  prefix: string
  folders: { name: string; prefix: string }[]
  files: { name: string; key: string; url: string; size: number }[]
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogg)$/i

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

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? "")
      const comma = result.indexOf(",")
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsDataURL(file)
  })
}

/**
 * A modal that browses the same Cloudflare R2 media as the File manager and
 * returns the chosen file's URL, so a URL field never has to be filled by hand.
 * `accept` filters the grid to images, videos, or both, and new files can be
 * uploaded straight into the current folder.
 */
export default function MediaPicker({
  open,
  onOpenChange,
  onSelect,
  accept = "all",
  title = "Choose media",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (url: string) => void
  accept?: "image" | "video" | "all"
  title?: string
}) {
  const [prefix, setPrefix] = useState("")
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function load(p = prefix) {
    setLoading(true)
    api(`/admin/r2?prefix=${encodeURIComponent(p)}`)
      .then((d) => setListing(d))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  // Reset to the root and load whenever the picker opens; reload on navigation.
  useEffect(() => {
    if (open) {
      setPrefix("")
      load("")
    }
  }, [open])

  useEffect(() => {
    if (open) load(prefix)
  }, [prefix])

  const crumbs = [{ label: "All media", prefix: "" }].concat(
    prefix
      .split("/")
      .filter(Boolean)
      .map((part, i, arr) => ({
        label: part,
        prefix: arr.slice(0, i + 1).join("/"),
      }))
  )

  const kindOf = (name: string): "image" | "video" | "other" =>
    IMAGE_RE.test(name) ? "image" : VIDEO_RE.test(name) ? "video" : "other"

  const showFile = (name: string) => {
    const k = kindOf(name)
    if (accept === "all") return k !== "other"
    return k === accept
  }

  async function upload(files: FileList | null) {
    if (!files || !files.length) return
    setBusy(true)
    const base = prefix ? `${prefix}/` : ""
    let lastUrl: string | null = null
    try {
      for (const file of Array.from(files)) {
        const contentBase64 = await readAsBase64(file)
        const res = await api("/admin/r2/upload", {
          method: "POST",
          body: JSON.stringify({
            key: `${base}${file.name}`,
            mimeType: file.type || "application/octet-stream",
            contentBase64,
          }),
        })
        lastUrl = res?.url ?? res?.file?.url ?? null
      }
      toast.success(`Uploaded ${files.length} file(s).`)
      load()
      // A single upload is almost always meant to be used right away.
      if (files.length === 1 && lastUrl) {
        onSelect(lastUrl)
        onOpenChange(false)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const files = (listing?.files ?? []).filter((f) => showFile(f.name))

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading level="h2">{title}</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col gap-4 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1">
              {crumbs.map((c, i) => (
                <span key={c.prefix} className="flex items-center gap-1">
                  {i > 0 ? <span className="text-ui-fg-muted">/</span> : null}
                  <button
                    type="button"
                    className={
                      i === crumbs.length - 1
                        ? "text-ui-fg-base text-sm font-medium"
                        : "text-ui-fg-interactive text-sm hover:underline"
                    }
                    onClick={() => setPrefix(c.prefix)}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </div>

            <div>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={
                  accept === "image"
                    ? "image/*"
                    : accept === "video"
                      ? "video/*"
                      : "image/*,video/*"
                }
                className="hidden"
                onChange={(e) => upload(e.target.files)}
              />
              <Button
                size="small"
                variant="secondary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <ArrowUpTray /> Upload
              </Button>
            </div>
          </div>

          {loading ? (
            <Text size="small">Loading&hellip;</Text>
          ) : (
            <div className="flex flex-col gap-5">
              {listing?.folders?.length ? (
                <div className="flex flex-wrap gap-2">
                  {listing.folders.map((f) => (
                    <button
                      key={f.prefix}
                      type="button"
                      onClick={() => setPrefix(f.prefix.replace(/\/$/, ""))}
                      className="hover:bg-ui-bg-subtle flex items-center gap-2 rounded-md border border-ui-border-base px-3 py-2"
                    >
                      <Folder className="text-ui-fg-muted" />
                      <Text size="small" weight="plus">
                        {f.name}
                      </Text>
                    </button>
                  ))}
                </div>
              ) : null}

              {files.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                  {files.map((file) => (
                    <button
                      key={file.key}
                      type="button"
                      title={file.name}
                      onClick={() => {
                        onSelect(file.url)
                        onOpenChange(false)
                      }}
                      className="group border-ui-border-base hover:border-ui-fg-interactive flex flex-col overflow-hidden rounded-lg border text-left"
                    >
                      <div className="bg-ui-bg-subtle flex aspect-square items-center justify-center">
                        {kindOf(file.name) === "image" ? (
                          <img
                            src={file.url}
                            alt={file.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : kindOf(file.name) === "video" ? (
                          <video
                            src={file.url}
                            muted
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Photo className="text-ui-fg-muted" />
                        )}
                      </div>
                      <Text size="xsmall" className="truncate px-2 py-1.5">
                        {file.name}
                      </Text>
                    </button>
                  ))}
                </div>
              ) : (
                <Text size="small" className="text-ui-fg-muted">
                  No {accept === "all" ? "media" : `${accept}s`} in this folder.
                  Open a folder above or upload a file.
                </Text>
              )}
            </div>
          )}
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
