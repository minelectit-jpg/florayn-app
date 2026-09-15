import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpTray, Folder, Photo, Plus, Trash } from "@medusajs/icons"
import { Badge, Button, Container, Heading, IconButton, Input, Text, toast } from "@medusajs/ui"
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react"

type Listing = {
  prefix: string
  folders: { name: string; prefix: string }[]
  files: { name: string; key: string; url: string; size: number }[]
}

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

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      await worker(items[i])
    }
  })
  await Promise.all(runners)
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i

const FileManagerPage = () => {
  const [prefix, setPrefix] = useState("")
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [newFolder, setNewFolder] = useState("")
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "")
      folderRef.current.setAttribute("directory", "")
    }
  }, [])

  function load(p = prefix) {
    setLoading(true)
    api(`/admin/r2?prefix=${encodeURIComponent(p)}`)
      .then((d) => setListing(d))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load(prefix)
  }, [prefix])

  const crumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean)
    const acc: { label: string; prefix: string }[] = [{ label: "All media", prefix: "" }]
    let cur = ""
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part
      acc.push({ label: part, prefix: cur })
    }
    return acc
  }, [prefix])

  async function createFolder() {
    const name = newFolder.trim()
    if (!name) return
    setBusy(true)
    try {
      await api("/admin/r2/folder", {
        method: "POST",
        body: JSON.stringify({ parent: prefix, name }),
      })
      setNewFolder("")
      toast.success(`Folder "${name}" created.`)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function uploadItems(items: { file: File; relPath: string }[]) {
    if (!items.length) return
    setBusy(true)
    setProgress({ done: 0, total: items.length })
    let done = 0
    let failed = 0
    const base = prefix ? `${prefix}/` : ""
    try {
      await pool(items, 5, async ({ file, relPath }) => {
        try {
          const key = `${base}${relPath}`
          const contentBase64 = await readAsBase64(file)
          await api("/admin/r2/upload", {
            method: "POST",
            body: JSON.stringify({
              key,
              mimeType: file.type || "application/octet-stream",
              contentBase64,
            }),
          })
        } catch {
          failed++
        } finally {
          done++
          setProgress({ done, total: items.length })
        }
      })
      if (failed) toast.error(`${failed} of ${items.length} file(s) failed to upload.`)
      else toast.success(`Uploaded ${items.length} file(s).`)
      load()
    } finally {
      setBusy(false)
      setProgress(null)
      if (filesRef.current) filesRef.current.value = ""
      if (folderRef.current) folderRef.current.value = ""
    }
  }

  function itemsFromFileList(fileList: FileList | null, keepStructure: boolean) {
    if (!fileList) return []
    return Array.from(fileList).map((file) => ({
      file,
      relPath: keepStructure ? (file as any).webkitRelativePath || file.name : file.name,
    }))
  }

  // Recursively walk a dropped file-system entry, preserving sub-folder paths.
  async function readEntry(entry: any, path: string, out: { file: File; relPath: string }[]) {
    if (!entry) return
    if (entry.isFile) {
      await new Promise<void>((resolve) =>
        entry.file(
          (f: File) => {
            out.push({ file: f, relPath: path + entry.name })
            resolve()
          },
          () => resolve()
        )
      )
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const all: any[] = []
      await new Promise<void>((resolve) => {
        const readBatch = () =>
          reader.readEntries((entries: any[]) => {
            if (!entries.length) resolve()
            else {
              all.push(...entries)
              readBatch()
            }
          }, () => resolve())
        readBatch()
      })
      for (const child of all) await readEntry(child, `${path}${entry.name}/`, out)
    }
  }

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    const dt = e.dataTransfer
    // Read entries synchronously (they expire after the event tick).
    const entries = Array.from(dt.items ?? [])
      .map((it: any) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean)
    const out: { file: File; relPath: string }[] = []
    if (entries.length) {
      for (const entry of entries) await readEntry(entry, "", out)
    } else {
      for (const f of Array.from(dt.files ?? [])) out.push({ file: f, relPath: f.name })
    }
    const items = out.filter((i) => i.relPath && !i.relPath.endsWith("/"))
    if (items.length) uploadItems(items)
  }

  async function removeFolder(p: string, name: string) {
    if (!window.confirm(`Delete the folder "${name}" and everything in it? This cannot be undone.`))
      return
    setBusy(true)
    try {
      const r = await api(`/admin/r2?target=${encodeURIComponent(p)}&type=folder`, {
        method: "DELETE",
      })
      toast.success(`Deleted "${name}" (${r.deleted} file(s)).`)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeFile(key: string, name: string) {
    if (!window.confirm(`Delete "${name}"?`)) return
    setBusy(true)
    try {
      await api(`/admin/r2?target=${encodeURIComponent(key)}&type=file`, { method: "DELETE" })
      toast.success(`Deleted "${name}".`)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const empty = !loading && listing && !listing.folders.length && !listing.files.length

  return (
    <Container
      className="divide-y relative p-0"
      onDragOver={(e) => {
        e.preventDefault()
        if (!busy) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {dragOver ? (
        <div className="bg-ui-bg-base/80 pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-ui-fg-interactive">
          <div className="flex flex-col items-center gap-2">
            <ArrowUpTray className="text-ui-fg-interactive" />
            <Text size="base" weight="plus">
              Drop files or folders here to upload
            </Text>
          </div>
        </div>
      ) : null}
      <div className="px-6 py-4">
        <Heading level="h1">File manager</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Your media on Cloudflare R2. <b>Drag &amp; drop</b> files or whole
          folders here to upload (structure kept), or use the buttons. Create and
          delete folders too. Organise your mockups here once, then point the New
          Design tool at a folder instead of uploading from your computer each time.
        </Text>
      </div>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 px-6 py-3">
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
        <IconButton
          size="small"
          variant="transparent"
          className="ml-2"
          onClick={() => load()}
          disabled={loading || busy}
        >
          <ArrowPath />
        </IconButton>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="New folder name"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            className="w-48"
            disabled={busy}
          />
          <Button
            variant="secondary"
            size="small"
            onClick={createFolder}
            disabled={busy || !newFolder.trim()}
          >
            <Plus /> Folder
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            ref={filesRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => uploadItems(itemsFromFileList(e.target.files, false))}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => uploadItems(itemsFromFileList(e.target.files, true))}
          />
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() => filesRef.current?.click()}
          >
            <ArrowUpTray /> Upload files
          </Button>
          <Button
            variant="primary"
            size="small"
            disabled={busy}
            onClick={() => folderRef.current?.click()}
          >
            <ArrowUpTray /> Upload folder
          </Button>
        </div>
      </div>

      {progress ? (
        <div className="flex items-center gap-2 px-6 py-2">
          <div className="bg-ui-bg-subtle h-2 w-48 overflow-hidden rounded-full">
            <div
              className="bg-ui-fg-interactive h-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <Text size="xsmall" className="text-ui-fg-muted">
            Uploading {progress.done}/{progress.total}
          </Text>
        </div>
      ) : null}

      <div className="px-6 py-4">
        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : empty ? (
          <Text size="small" className="text-ui-fg-muted">
            This folder is empty. Upload files or a folder to get started.
          </Text>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Folders */}
            {listing!.folders.length > 0 && (
              <div className="flex flex-col gap-1">
                {listing!.folders.map((f) => (
                  <div
                    key={f.prefix}
                    className="hover:bg-ui-bg-subtle flex items-center gap-3 rounded-md px-2 py-2"
                  >
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-3 text-left"
                      onClick={() => setPrefix(f.prefix.replace(/\/$/, ""))}
                    >
                      <Folder className="text-ui-fg-muted" />
                      <Text size="small" weight="plus">
                        {f.name}
                      </Text>
                    </button>
                    <IconButton
                      size="small"
                      variant="transparent"
                      disabled={busy}
                      onClick={() => removeFolder(f.prefix, f.name)}
                    >
                      <Trash className="text-ui-fg-error" />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}

            {/* Files */}
            {listing!.files.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {listing!.files.map((file) => (
                  <div
                    key={file.key}
                    className="border-ui-border-base group relative flex flex-col overflow-hidden rounded-lg border"
                  >
                    <div className="bg-ui-bg-subtle flex aspect-square items-center justify-center">
                      {IMAGE_RE.test(file.name) ? (
                        <img
                          src={file.url}
                          alt={file.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Photo className="text-ui-fg-muted" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <Text size="xsmall" className="truncate" title={file.name}>
                          {file.name}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {humanSize(file.size)}
                        </Text>
                      </div>
                      <IconButton
                        size="small"
                        variant="transparent"
                        disabled={busy}
                        onClick={() => removeFile(file.key, file.name)}
                      >
                        <Trash className="text-ui-fg-error" />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Badge color="grey" className="self-start">
              {listing!.folders.length} folder(s), {listing!.files.length} file(s)
            </Badge>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "File manager",
  icon: Folder,
})

export default FileManagerPage
