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

/**
 * Folder-name aliases so the owner's FileBird case-type folders auto-map to the
 * store's case types. Anything not covered here (e.g. "Tough MagSafe") stays
 * unmatched and the admin picks it from a dropdown.
 */
const CASE_ALIASES: Record<string, string> = {
  // "Tough MagSafe" (spelt "Though MagSafe" in the owner's FileBird) = Signature.
  "tough-magsafe": "signature",
  "though-magsafe": "signature",
  "signature-magsafe": "signature",
  "elite-transparent-magsafe": "elite-clear",
  "elite-transparent": "elite-clear",
  "elite-clear-magsafe": "elite-clear",
  "armor-transparent-magsafe": "armor-clear",
  "armor-transparent": "armor-clear",
  "armor-clear-magsafe": "armor-clear",
  "armor-black-magsafe": "armor-black",
  "essentials-magsafe": "essentials",
}

/**
 * Product-form folder names. They sit between design and device (or design and
 * files) in the owner's tree and are never a case type, design or device, so
 * they are skipped when detecting the design.
 */
const FORM_SEGMENTS = new Set([
  "phone-case",
  "phone-cases",
  "airpods",
  "airpods-case",
  "airpods-cases",
  "earbuds",
  "earbuds-case",
  "watch-bands",
  "watch-band",
  "card-holder",
  "card-holders",
  "magsafe-card-holder",
  "card-wallet",
  "pen",
  "phone-charms",
  "stickpad",
])

/**
 * Watch/wallet forms have NO device sub-folder - the images sit straight in the
 * form folder. Treat the form folder itself as its single device.
 */
const FORM_DEVICE: Record<string, string> = {
  "watch-bands": "apple-watch-band",
  "watch-band": "apple-watch-band",
  "magsafe-card-holder": "magsafe-wallet",
  "card-holder": "card-wallet",
  "card-holders": "card-wallet",
}

// ----------------------------------------------------------------------------
// Create designs from a folder already on R2 (uploaded via the File Manager) -
// no re-upload from the computer. This is the primary path.

type Analysis = {
  prefix: string
  totalFiles: number
  designs: { name: string; slug: string; caseTypes: { slug: string; images: number }[]; images: number }[]
  skipped: number
  unmatchedCases: string[]
  unmatchedDevices: string[]
}

const CreateFromR2 = ({ onCreated }: { onCreated: () => void }) => {
  const [prefix, setPrefix] = useState("")
  const [folders, setFolders] = useState<{ name: string; prefix: string }[]>([])
  const [loadingFolders, setLoadingFolders] = useState(true)
  const [theme, setTheme] = useState("")
  const [blankStock, setBlankStock] = useState("10")
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [busy, setBusy] = useState(false)

  function loadFolders(p = prefix) {
    setLoadingFolders(true)
    setAnalysis(null)
    api(`/admin/r2?prefix=${encodeURIComponent(p)}`)
      .then((d) => setFolders(d.folders ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoadingFolders(false))
  }
  useEffect(() => {
    loadFolders(prefix)
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

  async function analyze() {
    if (!prefix) {
      toast.error("Open a folder first.")
      return
    }
    setAnalyzing(true)
    try {
      const d: Analysis = await api(`/admin/designs/from-r2?prefix=${encodeURIComponent(prefix)}`)
      setAnalysis(d)
      if (!theme) setTheme(prefix.split("/")[0] ?? "")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  async function create() {
    if (!analysis?.designs.length) return
    setBusy(true)
    try {
      const d = await api("/admin/designs/from-r2", {
        method: "POST",
        body: JSON.stringify({
          prefix,
          theme: theme.trim() || null,
          blankStock: Number(blankStock) || 10,
        }),
      })
      const parts = [`${d.created.length} created`]
      if (d.existed.length) parts.push(`${d.existed.length} already existed`)
      if (d.failed.length) parts.push(`${d.failed.length} failed`)
      if (d.failed.length) {
        toast.error(
          `Done with issues: ${parts.join(", ")}. First: ${d.failed[0].name} - ${d.failed[0].message}`
        )
      } else {
        toast.success(`Done: ${parts.join(", ")}.`)
      }
      if (d.created.length) {
        setAnalysis(null)
        onCreated()
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const totalImages = analysis?.designs.reduce((n, d) => n + d.images, 0) ?? 0

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Create from a File Manager folder</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Point at a folder you have already uploaded to the{" "}
          <b>File Manager</b> and it builds every design inside it - no re-upload
          from your computer. Open the folder that holds your case-type folders
          (e.g. <code>Florayn Garage/Phone Case</code>), then Analyse.
        </Text>
      </div>

      {/* Folder browser */}
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
      </div>

      <div className="px-6 py-2">
        {loadingFolders ? (
          <Text size="small">Loading&hellip;</Text>
        ) : folders.length ? (
          <div className="flex flex-wrap gap-2">
            {folders.map((f) => (
              <Button
                key={f.prefix}
                variant="secondary"
                size="small"
                disabled={busy || analyzing}
                onClick={() => setPrefix(f.prefix.replace(/\/$/, ""))}
              >
                {f.name}
              </Button>
            ))}
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-muted">
            No sub-folders here.
          </Text>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-6 py-3">
        <Button
          variant="primary"
          size="small"
          isLoading={analyzing}
          disabled={!prefix || busy}
          onClick={analyze}
        >
          Analyse this folder
        </Button>
        {prefix ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            Selected: <span className="font-mono">{prefix}</span>
          </Text>
        ) : null}
      </div>

      {analysis && (
        <>
          <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label size="small">Collection (optional)</Label>
              <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. Garage" />
              <Text size="xsmall" className="text-ui-fg-muted">
                Applied to every design created here.
              </Text>
            </div>
            <div className="flex flex-col gap-1">
              <Label size="small">Starting blank stock</Label>
              <Input
                type="number"
                min={0}
                value={blankStock}
                onChange={(e) => setBlankStock(e.target.value)}
              />
            </div>
          </div>

          <div className="px-6 py-4">
            <Text size="small" weight="plus" className="mb-2">
              Found {analysis.designs.length} design(s), {totalImages} image(s)
              {analysis.skipped ? ` (${analysis.skipped} file(s) skipped)` : ""}
            </Text>
            {(analysis.unmatchedCases.length > 0 || analysis.unmatchedDevices.length > 0) && (
              <Text size="xsmall" className="text-ui-fg-error mb-2">
                Not matched (these are skipped):{" "}
                {[...analysis.unmatchedCases, ...analysis.unmatchedDevices].join(", ")}
              </Text>
            )}
            {analysis.designs.length ? (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Design</Table.HeaderCell>
                    <Table.HeaderCell>Case types</Table.HeaderCell>
                    <Table.HeaderCell>Images</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {analysis.designs.map((d) => (
                    <Table.Row key={d.slug}>
                      <Table.Cell>
                        <Text size="small" weight="plus">
                          {d.name}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {d.caseTypes.map((c) => c.slug).join(", ")}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="xsmall">{d.images}</Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            ) : null}
          </div>

          <div className="px-6 py-4">
            <Button
              variant="primary"
              isLoading={busy}
              disabled={!analysis.designs.length || busy}
              onClick={create}
            >
              Create {analysis.designs.length > 1 ? `${analysis.designs.length} designs` : "design"}
            </Button>
          </div>
        </>
      )}
    </Container>
  )
}

type ParsedFile = {
  file: File
  caseRaw: string
  designRaw: string
  deviceRaw: string
  name: string
}

/**
 * Work out which path segment is the case type, which is the design and which
 * is the device - by CONTENT, not by fixed position, because the owner's
 * collections nest differently (Garage: .../Form/CaseType/Design/Device/file;
 * Alcantara: CaseType/Design/Form[/Device]/file). Returns segment indices, or
 * null when a file cannot be understood.
 */
function detectRoles(
  dirs: string[],
  caseLookup: Map<string, string>,
  deviceLookup: Map<string, string>
): { caseIdx: number; designIdx: number; deviceIdx: number } | null {
  const slugs = dirs.map(slugify)
  const last = (test: (i: number) => boolean) => {
    for (let i = dirs.length - 1; i >= 0; i--) if (test(i)) return i
    return -1
  }

  // Device: deepest segment that resolves to a device (watch/wallet form folders
  // resolve too, see the lookup).
  const deviceIdx = last((i) => deviceLookup.has(slugs[i]))
  if (deviceIdx === -1) return null

  // Case type: deepest OTHER segment that resolves to a case type.
  const caseIdx = last((i) => i !== deviceIdx && caseLookup.has(slugs[i]))

  // Design: deepest remaining segment that is not the device, not the case type
  // and not a form label.
  const designIdx = last(
    (i) => i !== deviceIdx && i !== caseIdx && !FORM_SEGMENTS.has(slugs[i])
  )
  if (designIdx === -1) return null

  // When the case type did not resolve, still surface a segment for the manual
  // picker: the deepest one that is not device, design or form.
  const caseRawIdx =
    caseIdx !== -1
      ? caseIdx
      : last(
          (i) => i !== deviceIdx && i !== designIdx && !FORM_SEGMENTS.has(slugs[i])
        )
  if (caseRawIdx === -1) return null

  return { caseIdx: caseRawIdx, designIdx, deviceIdx }
}

// ----------------------------------------------------------------------------

const UploadDesign = ({ onCreated }: { onCreated: () => void }) => {
  const [caseOptions, setCaseOptions] = useState<{ slug: string; name: string }[]>([])
  const [deviceOptions, setDeviceOptions] = useState<{ slug: string; name: string }[]>([])

  const [theme, setTheme] = useState("")
  const [blankStock, setBlankStock] = useState("10")
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [folderLabel, setFolderLabel] = useState("")
  const [skippedCount, setSkippedCount] = useState(0)

  // raw folder segment (slugified) -> chosen canonical slug ("" = unresolved)
  const [caseMap, setCaseMap] = useState<Record<string, string>>({})
  const [deviceMap, setDeviceMap] = useState<Record<string, string>>({})

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null
  )

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

  // Auto-match a raw folder name against known slugs, display names and aliases.
  const caseLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of caseOptions) {
      m.set(c.slug, c.slug)
      m.set(slugify(c.name), c.slug)
    }
    const known = new Set(caseOptions.map((c) => c.slug))
    for (const [alias, target] of Object.entries(CASE_ALIASES)) {
      if (known.has(target)) m.set(alias, target)
    }
    return m
  }, [caseOptions])

  const deviceLookup = useMemo(() => {
    const m = new Map<string, string>()
    const known = new Set(deviceOptions.map((d) => d.slug))
    for (const d of deviceOptions) {
      m.set(d.slug, d.slug)
      m.set(slugify(d.name), d.slug)
      // The owner's folders drop the brand ("16 Pro Max", "S26 Ultra").
      if (d.slug.startsWith("iphone-")) m.set(d.slug.slice("iphone-".length), d.slug)
      else if (d.slug.startsWith("samsung-")) m.set(d.slug.slice("samsung-".length), d.slug)
    }
    // Watch/wallet form folders act as their own (single) device.
    for (const [form, deviceSlug] of Object.entries(FORM_DEVICE)) {
      if (known.has(deviceSlug)) m.set(form, deviceSlug)
    }
    return m
  }, [deviceOptions])

  function onPick(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    const parsed: ParsedFile[] = []
    let collectionGuess = ""
    let skipped = 0
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith("image/")) continue
      const rel = (file as any).webkitRelativePath || file.name
      const segs = String(rel).split("/").filter(Boolean)
      const dirs = segs.slice(0, -1)
      // Need at least <case type>/<design>/<device>, or <case type>/<design> for
      // a device-less watch/wallet form.
      if (dirs.length < 2) {
        skipped++
        continue
      }
      const roles = detectRoles(dirs, caseLookup, deviceLookup)
      if (!roles) {
        skipped++
        continue
      }
      const caseRaw = dirs[roles.caseIdx]
      const designRaw = dirs[roles.designIdx]
      const deviceRaw = dirs[roles.deviceIdx]
      // A leftover shallow segment (not case/design/device/form) is the collection.
      if (!collectionGuess) {
        for (let i = 0; i < dirs.length; i++) {
          if (i === roles.caseIdx || i === roles.designIdx || i === roles.deviceIdx) continue
          if (FORM_SEGMENTS.has(slugify(dirs[i]))) continue
          collectionGuess = dirs[i]
          break
        }
      }
      parsed.push({ file, caseRaw, designRaw, deviceRaw, name: segs[segs.length - 1] })
    }
    if (!parsed.length) {
      toast.error(
        "No <case type>/<design>/<device>/image folders found. Pick the 'Phone Case' folder."
      )
      return
    }
    setFiles(parsed)
    setSkippedCount(skipped)
    const designs = new Set(parsed.map((p) => p.designRaw)).size
    setFolderLabel(`${designs} design(s), ${parsed.length} image(s)`)
    if (!theme && collectionGuess) setTheme(collectionGuess)

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

  const caseRaws = useMemo(
    () => [...new Set(files.map((f) => slugify(f.caseRaw)))],
    [files]
  )
  const deviceRaws = useMemo(
    () => [...new Set(files.map((f) => slugify(f.deviceRaw)))],
    [files]
  )
  // Show a picker only for raw names we could not auto-match, plus the raw label.
  const caseRawLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of files) m.set(slugify(f.caseRaw), f.caseRaw)
    return m
  }, [files])
  const deviceRawLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of files) m.set(slugify(f.deviceRaw), f.deviceRaw)
    return m
  }, [files])
  const unresolvedCases = caseRaws.filter((r) => !caseMap[r])
  const unresolvedDevices = deviceRaws.filter((r) => !deviceMap[r])

  // design name -> case slug -> device slug -> files (natural-sorted).
  const grouped = useMemo(() => {
    const byDesign = new Map<string, Map<string, Map<string, ParsedFile[]>>>()
    for (const f of files) {
      const cs = caseMap[slugify(f.caseRaw)]
      const ds = deviceMap[slugify(f.deviceRaw)]
      if (!cs || !ds) continue
      const design = f.designRaw
      const caseMapForDesign = byDesign.get(design) ?? new Map<string, Map<string, ParsedFile[]>>()
      const devMap = caseMapForDesign.get(cs) ?? new Map<string, ParsedFile[]>()
      const list = devMap.get(ds) ?? []
      list.push(f)
      devMap.set(ds, list)
      caseMapForDesign.set(cs, devMap)
      byDesign.set(design, caseMapForDesign)
    }
    for (const caseMapForDesign of byDesign.values()) {
      for (const devMap of caseMapForDesign.values()) {
        for (const list of devMap.values()) list.sort((a, b) => naturalCompare(a.name, b.name))
      }
    }
    return byDesign
  }, [files, caseMap, deviceMap])

  const caseName = (slugv: string) => caseOptions.find((c) => c.slug === slugv)?.name ?? slugv

  const totalImages = useMemo(() => {
    let n = 0
    for (const cm of grouped.values())
      for (const dm of cm.values()) for (const l of dm.values()) n += l.length
    return n
  }, [grouped])

  function reset() {
    setTheme("")
    setBlankStock("10")
    setFiles([])
    setFolderLabel("")
    setSkippedCount(0)
    setCaseMap({})
    setDeviceMap({})
    setProgress(null)
    if (dirRef.current) dirRef.current.value = ""
  }

  const canCreate =
    files.length > 0 &&
    grouped.size > 0 &&
    unresolvedCases.length === 0 &&
    unresolvedDevices.length === 0 &&
    !busy

  async function create() {
    if (!canCreate) return
    setBusy(true)
    const designList = [...grouped.entries()]
    const total = totalImages
    let done = 0
    const created: string[] = []
    const existed: string[] = []
    const failed: string[] = []

    try {
      for (const [designName, caseMapForDesign] of designList) {
        setProgress({ done, total, label: designName })
        const slug = slugify(designName)

        // Build the pair -> URL map, uploading every file first (ordered slots).
        const pairs: Record<string, Record<string, string[]>> = {}
        const jobs: {
          caseSlug: string
          deviceSlug: string
          slot: number
          file: File
          fileName: string
        }[] = []
        for (const [caseSlug, devMap] of caseMapForDesign) {
          pairs[caseSlug] = {}
          for (const [deviceSlug, list] of devMap) {
            pairs[caseSlug][deviceSlug] = new Array(list.length).fill("")
            list.forEach((pf, slot) =>
              jobs.push({ caseSlug, deviceSlug, slot, file: pf.file, fileName: pf.name })
            )
          }
        }

        let uploadFailed = 0
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
            uploadFailed++
          } finally {
            done++
            setProgress({ done, total, label: designName })
          }
        })

        if (uploadFailed) {
          failed.push(`${designName} (${uploadFailed} image upload(s) failed)`)
          continue
        }
        for (const caseSlug of Object.keys(pairs)) {
          for (const deviceSlug of Object.keys(pairs[caseSlug])) {
            pairs[caseSlug][deviceSlug] = pairs[caseSlug][deviceSlug].filter(Boolean)
          }
        }

        try {
          await api("/admin/designs/custom", {
            method: "POST",
            body: JSON.stringify({
              name: designName,
              slug,
              theme: theme.trim() || null,
              blankStock: Number(blankStock) || 10,
              pairs,
            }),
          })
          created.push(designName)
        } catch (e: any) {
          if (/already exists|already in the store/i.test(e.message ?? "")) {
            existed.push(designName)
          } else {
            failed.push(`${designName}: ${e.message}`)
          }
        }
      }

      const parts = [`${created.length} created`]
      if (existed.length) parts.push(`${existed.length} already existed`)
      if (failed.length) parts.push(`${failed.length} failed`)
      if (failed.length) {
        toast.error(`Done with issues: ${parts.join(", ")}. First: ${failed[0]}`)
      } else {
        toast.success(`Done: ${parts.join(", ")}.`)
      }
      if (created.length) {
        reset()
        onCreated()
      }
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
          Pick your mockup folder laid out as{" "}
          <code>&lt;case type&gt;/&lt;design&gt;/&lt;device&gt;/1.webp</code> (pick
          the <b>Phone Case</b> folder to do a whole collection at once). It uploads
          every image to R2 in that structure, then builds each design&rsquo;s Case
          Type + Device product with shared blank stock. Case-type and device folder
          names are matched to the store automatically; anything unmatched you map
          below.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label size="small">Collection (optional)</Label>
          <Input
            placeholder="e.g. Garage"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Applied to every design in this upload.
          </Text>
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
        {skippedCount ? (
          <Badge color="orange">{skippedCount} file(s) skipped (unexpected layout)</Badge>
        ) : null}
      </div>

      {(unresolvedCases.length > 0 || unresolvedDevices.length > 0) && (
        <div className="flex flex-col gap-3 px-6 py-4">
          <Text size="small" weight="plus" className="text-ui-fg-error">
            These folder names did not match the store. Pick what they are:
          </Text>
          {unresolvedCases.map((raw) => (
            <div key={`c-${raw}`} className="flex items-center gap-3">
              <Text size="small" className="w-56 truncate">
                Case type folder: <span className="font-mono">{caseRawLabel.get(raw)}</span>
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
              <Text size="small" className="w-56 truncate">
                Device folder: <span className="font-mono">{deviceRawLabel.get(raw)}</span>
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
            Ready: {grouped.size} design(s), {totalImages} image(s)
          </Text>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Design</Table.HeaderCell>
                <Table.HeaderCell>Case types</Table.HeaderCell>
                <Table.HeaderCell>Images</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {[...grouped.entries()].map(([designName, cm]) => {
                let imgs = 0
                for (const dm of cm.values()) for (const l of dm.values()) imgs += l.length
                return (
                  <Table.Row key={designName}>
                    <Table.Cell>
                      <Text size="small" weight="plus">
                        {designName}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {[...cm.keys()].map(caseName).join(", ")}
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
          Create {grouped.size > 1 ? `${grouped.size} designs` : "design"}
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
              {progress.label} &middot; {progress.done}/{progress.total}
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
      <CreateFromR2 onCreated={load} />
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
