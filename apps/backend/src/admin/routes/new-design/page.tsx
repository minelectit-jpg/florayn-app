import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Sparkles } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useRef, useState } from "react"

type Design = {
  slug: string
  name: string
  theme: string | null
  caseTypes: string[]
  live: boolean
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Natural sort so "1, 2, 10" order rather than "1, 10, 2". */
function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
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

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      await worker(items[i], i)
    }
  })
  await Promise.all(runners)
}

type ParsedFile = {
  file: File
  caseRaw: string
  deviceRaw: string
  name: string
}

// ----------------------------------------------------------------------------

const UploadDesign = ({ onCreated }: { onCreated: () => void }) => {
  const [caseOptions, setCaseOptions] = useState<{ slug: string; name: string }[]>([])
  const [deviceOptions, setDeviceOptions] = useState<{ slug: string; name: string }[]>([])

  const [name, setName] = useState("")
  const [theme, setTheme] = useState("")
  const [blankStock, setBlankStock] = useState("10")
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [folderLabel, setFolderLabel] = useState("")

  // raw folder segment (slugified) -> chosen canonical slug ("" = unresolved)
  const [caseMap, setCaseMap] = useState<Record<string, string>>({})
  const [deviceMap, setDeviceMap] = useState<Record<string, string>>({})

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const dirRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (dirRef.current) {
      dirRef.current.setAttribute("webkitdirectory", "")
      dirRef.current.setAttribute("directory", "")
    }
  }, [])

  useEffect(() => {
    Promise.all([api("/admin/case-types"), api("/admin/devices")])
      .then(([ct, dv]) => {
        setCaseOptions((ct.case_types ?? []).map((c: any) => ({ slug: c.slug, name: c.name })))
        setDeviceOptions(
          (dv.devices ?? [])
            .filter((d: any) => d.is_active !== false)
            .map((d: any) => ({ slug: d.slug, name: d.name }))
        )
      })
      .catch((e) => toast.error(e.message))
  }, [])

  // Auto-match a raw folder name against known slugs and display names.
  const caseLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of caseOptions) {
      m.set(c.slug, c.slug)
      m.set(slugify(c.name), c.slug)
    }
    return m
  }, [caseOptions])
  const deviceLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of deviceOptions) {
      m.set(d.slug, d.slug)
      m.set(slugify(d.name), d.slug)
    }
    return m
  }, [deviceOptions])

  function onPick(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    const parsed: ParsedFile[] = []
    let top = ""
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith("image/")) continue
      const rel = (file as any).webkitRelativePath || file.name
      const parts = String(rel).split("/").filter(Boolean)
      const dirs = parts.slice(0, -1)
      if (dirs.length >= 1) top = top || dirs[0]
      const deviceRaw = dirs[dirs.length - 1] ?? ""
      const caseRaw = dirs[dirs.length - 2] ?? ""
      if (!deviceRaw || !caseRaw) continue
      parsed.push({ file, caseRaw, deviceRaw, name: parts[parts.length - 1] })
    }
    if (!parsed.length) {
      toast.error("No case-type/device folders found. Expected <caseType>/<device>/image.")
      return
    }
    setFiles(parsed)
    setFolderLabel(`${top || "selection"} - ${parsed.length} image(s)`)
    if (!name && top) setName(top.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))

    // Seed the resolution maps from auto-matching.
    const cMap: Record<string, string> = {}
    const dMap: Record<string, string> = {}
    for (const p of parsed) {
      const cs = slugify(p.caseRaw)
      const ds = slugify(p.deviceRaw)
      if (!(cs in cMap)) cMap[cs] = caseLookup.get(cs) ?? ""
      if (!(ds in dMap)) dMap[ds] = deviceLookup.get(ds) ?? ""
    }
    setCaseMap(cMap)
    setDeviceMap(dMap)
  }

  const slug = useMemo(() => slugify(name), [name])

  // Distinct raw segments, for the mapping UI.
  const caseRaws = useMemo(
    () => [...new Set(files.map((f) => slugify(f.caseRaw)))],
    [files]
  )
  const deviceRaws = useMemo(
    () => [...new Set(files.map((f) => slugify(f.deviceRaw)))],
    [files]
  )
  const unresolvedCases = caseRaws.filter((r) => !caseMap[r])
  const unresolvedDevices = deviceRaws.filter((r) => !deviceMap[r])

  // Build the resolved pair -> files grouping for the summary + upload.
  const grouped = useMemo(() => {
    const byCase = new Map<string, Map<string, ParsedFile[]>>()
    for (const f of files) {
      const cs = caseMap[slugify(f.caseRaw)]
      const ds = deviceMap[slugify(f.deviceRaw)]
      if (!cs || !ds) continue
      const devMap = byCase.get(cs) ?? new Map<string, ParsedFile[]>()
      const list = devMap.get(ds) ?? []
      list.push(f)
      devMap.set(ds, list)
      byCase.set(cs, devMap)
    }
    for (const devMap of byCase.values()) {
      for (const list of devMap.values()) list.sort((a, b) => naturalCompare(a.name, b.name))
    }
    return byCase
  }, [files, caseMap, deviceMap])

  const caseName = (slugv: string) => caseOptions.find((c) => c.slug === slugv)?.name ?? slugv
  const deviceName = (slugv: string) => deviceOptions.find((d) => d.slug === slugv)?.name ?? slugv

  const resolvedImageCount = useMemo(() => {
    let n = 0
    for (const devMap of grouped.values()) for (const list of devMap.values()) n += list.length
    return n
  }, [grouped])

  function reset() {
    setName("")
    setTheme("")
    setBlankStock("10")
    setFiles([])
    setFolderLabel("")
    setCaseMap({})
    setDeviceMap({})
    setProgress(null)
    if (dirRef.current) dirRef.current.value = ""
  }

  const canCreate =
    !!name.trim() &&
    files.length > 0 &&
    resolvedImageCount > 0 &&
    unresolvedCases.length === 0 &&
    unresolvedDevices.length === 0 &&
    !busy

  async function create() {
    if (!canCreate) return
    setBusy(true)
    try {
      // Flatten every resolved file with its target slot, keeping order.
      const jobs: {
        caseSlug: string
        deviceSlug: string
        slot: number
        file: File
        fileName: string
      }[] = []
      const pairs: Record<string, Record<string, string[]>> = {}
      for (const [caseSlug, devMap] of grouped) {
        pairs[caseSlug] = {}
        for (const [deviceSlug, list] of devMap) {
          pairs[caseSlug][deviceSlug] = new Array(list.length).fill("")
          list.forEach((pf, slot) =>
            jobs.push({ caseSlug, deviceSlug, slot, file: pf.file, fileName: pf.name })
          )
        }
      }

      setProgress({ done: 0, total: jobs.length })
      let done = 0
      let failed = 0
      await pool(jobs, 5, async (job) => {
        try {
          const contentBase64 = await readAsBase64(job.file)
          const r = await api("/admin/designs/upload", {
            method: "POST",
            body: JSON.stringify({
              designSlug: slug,
              caseTypeSlug: job.caseSlug,
              deviceSlug: job.deviceSlug,
              index: job.slot + 1,
              filename: job.fileName,
              mimeType: job.file.type || "image/webp",
              contentBase64,
            }),
          })
          pairs[job.caseSlug][job.deviceSlug][job.slot] = r.url
        } catch {
          failed++
        } finally {
          done++
          setProgress({ done, total: jobs.length })
        }
      })

      if (failed) {
        throw new Error(`${failed} of ${jobs.length} images failed to upload. Try again.`)
      }
      // Drop any empty slots defensively.
      for (const caseSlug of Object.keys(pairs)) {
        for (const deviceSlug of Object.keys(pairs[caseSlug])) {
          pairs[caseSlug][deviceSlug] = pairs[caseSlug][deviceSlug].filter(Boolean)
        }
      }

      const created = await api("/admin/designs/custom", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          slug,
          theme: theme.trim() || null,
          blankStock: Number(blankStock) || 10,
          pairs,
        }),
      })
      const r = created.result
      toast.success(
        `${name.trim()} added: ${r.products.length} product(s), ${r.variants} variants, ` +
          `${r.images} images, ${r.blanksCreated} new blank(s).`
      )
      reset()
      onCreated()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Upload a new design</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Pick a folder of finished mockups laid out as{" "}
          <code>&lt;case type&gt;/&lt;device&gt;/1.webp</code> (a design folder on
          top is fine too). It uploads every image to R2 in that structure, then
          builds the phone case (and AirPods etc.) product with Case Type + Device
          options, only the pairs you uploaded, and shared blank stock.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label size="small">Design name</Label>
          <Input
            placeholder="e.g. Amber Leopard"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {slug ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              handle: {slug}
            </Text>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <Label size="small">Collection (optional)</Label>
          <Input
            placeholder="e.g. Garage"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label size="small">Starting blank stock</Label>
          <Input
            type="number"
            min={0}
            value={blankStock}
            onChange={(e) => setBlankStock(e.target.value)}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Only applied to blanks that do not exist yet.
          </Text>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <input
          ref={dirRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => onPick(e.target.files)}
          className="text-ui-fg-subtle text-sm"
        />
        {folderLabel ? <Badge color="grey">{folderLabel}</Badge> : null}
      </div>

      {(unresolvedCases.length > 0 || unresolvedDevices.length > 0) && (
        <div className="flex flex-col gap-3 px-6 py-4">
          <Text size="small" weight="plus" className="text-ui-fg-error">
            Some folders did not match a known case type / device. Map them to
            continue:
          </Text>
          {unresolvedCases.map((raw) => (
            <div key={`c-${raw}`} className="flex items-center gap-3">
              <Text size="small" className="w-48 truncate">
                Case folder: <span className="font-mono">{raw}</span>
              </Text>
              <div className="w-64">
                <Select
                  value={caseMap[raw] || undefined}
                  onValueChange={(v) => setCaseMap((m) => ({ ...m, [raw]: v }))}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Choose case type" />
                  </Select.Trigger>
                  <Select.Content>
                    {caseOptions.map((c) => (
                      <Select.Item key={c.slug} value={c.slug}>
                        {c.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>
          ))}
          {unresolvedDevices.map((raw) => (
            <div key={`d-${raw}`} className="flex items-center gap-3">
              <Text size="small" className="w-48 truncate">
                Device folder: <span className="font-mono">{raw}</span>
              </Text>
              <div className="w-64">
                <Select
                  value={deviceMap[raw] || undefined}
                  onValueChange={(v) => setDeviceMap((m) => ({ ...m, [raw]: v }))}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Choose device" />
                  </Select.Trigger>
                  <Select.Content>
                    {deviceOptions.map((d) => (
                      <Select.Item key={d.slug} value={d.slug}>
                        {d.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>
          ))}
        </div>
      )}

      {grouped.size > 0 && (
        <div className="px-6 py-4">
          <Text size="small" weight="plus" className="mb-2">
            Ready to create: {grouped.size} case type(s), {resolvedImageCount} image(s)
          </Text>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Case type</Table.HeaderCell>
                <Table.HeaderCell>Devices</Table.HeaderCell>
                <Table.HeaderCell>Images</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {[...grouped.entries()].map(([caseSlug, devMap]) => {
                let imgs = 0
                for (const l of devMap.values()) imgs += l.length
                return (
                  <Table.Row key={caseSlug}>
                    <Table.Cell>
                      <Text size="small" weight="plus">
                        {caseName(caseSlug)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {[...devMap.keys()].map(deviceName).join(", ")}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="xsmall">{imgs}</Text>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 px-6 py-4">
        <Button variant="primary" disabled={!canCreate} isLoading={busy} onClick={create}>
          Create design
        </Button>
        {files.length > 0 ? (
          <Button variant="secondary" disabled={busy} onClick={reset}>
            Clear
          </Button>
        ) : null}
        {progress ? (
          <div className="flex items-center gap-2">
            <div className="bg-ui-bg-subtle h-2 w-40 overflow-hidden rounded-full">
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
      </div>
    </Container>
  )
}

// ----------------------------------------------------------------------------

const NewDesignPage = () => {
  const [designs, setDesigns] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [onlyPending, setOnlyPending] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api("/admin/designs")
      .then((d) => setDesigns(d.designs ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function add(design: Design) {
    setAdding(design.slug)
    try {
      const d = await api("/admin/designs", {
        method: "POST",
        body: JSON.stringify({ slug: design.slug }),
      })
      const r = d.result
      setDesigns((list) =>
        list.map((x) => (x.slug === design.slug ? { ...x, live: true } : x))
      )
      toast.success(
        `${design.name}: ${r.products.length} product(s), ${r.variants} variants, ` +
          `${r.imagesWired} images wired.`
      )
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAdding(null)
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return designs.filter((d) => {
      if (onlyPending && d.live) return false
      if (needle && !d.name.toLowerCase().includes(needle) && !d.slug.includes(needle)) {
        return false
      }
      return true
    })
  }, [designs, q, onlyPending])

  const liveCount = designs.filter((d) => d.live).length

  return (
    <div className="flex flex-col gap-6">
      <UploadDesign onCreated={load} />

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Import from the catalogue</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Add a design that already has swept artwork in one click: it builds the
            product with Case Type + Device options, the sold pairs, shared blank
            stock, and wires its images.
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <Input
            placeholder="Search designs&hellip;"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <Button
            variant={onlyPending ? "primary" : "secondary"}
            size="small"
            onClick={() => setOnlyPending((v) => !v)}
          >
            {onlyPending ? "Showing not-yet-added" : "Showing all"}
          </Button>
          <Badge color="grey">
            {liveCount} / {designs.length} live
          </Badge>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <Text size="small">Loading&hellip;</Text>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Design</Table.HeaderCell>
                  <Table.HeaderCell>Collection</Table.HeaderCell>
                  <Table.HeaderCell>Case types</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {filtered.map((d) => (
                  <Table.Row key={d.slug}>
                    <Table.Cell>
                      <Text size="small" weight="plus" className="capitalize">
                        {d.name}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small" className="text-ui-fg-muted">
                        {d.theme ?? "-"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {d.caseTypes.length}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {d.live ? (
                        <Badge size="2xsmall" color="green">
                          Live
                        </Badge>
                      ) : (
                        <Button
                          size="small"
                          variant="secondary"
                          isLoading={adding === d.slug}
                          disabled={!!adding}
                          onClick={() => add(d)}
                        >
                          Add to store
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "New design",
  icon: Sparkles,
})

export default NewDesignPage
