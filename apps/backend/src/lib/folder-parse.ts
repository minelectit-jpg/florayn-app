import { CASE_TYPES } from "../modules/catalog/data/case-types"
import { DEVICES } from "../modules/catalog/data/devices"

/**
 * Server-side twin of the New Design uploader's folder parsing. Given a list of
 * R2 object keys laid out like the owner's FileBird tree
 * (.../<case type>/<design>/<device>/<n>.webp, in any nesting), work out each
 * file's case type / design / device by CONTENT and group them into per-design
 * image maps ready for createUploadedDesign - so a design can be built from a
 * folder already on R2, with no re-upload.
 *
 * Kept deliberately parallel to the client copy in admin/routes/new-design; the
 * two cannot share a module across the server / admin-bundle boundary cleanly.
 */

export function slugify(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const CASE_ALIASES: Record<string, string> = {
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

const FORM_DEVICE: Record<string, string> = {
  "watch-bands": "apple-watch-band",
  "watch-band": "apple-watch-band",
  "magsafe-card-holder": "magsafe-wallet",
  "card-holder": "card-wallet",
  "card-holders": "card-wallet",
}

function buildCaseLookup(): Map<string, string> {
  const m = new Map<string, string>()
  const known = new Set(CASE_TYPES.map((c) => c.slug))
  for (const c of CASE_TYPES) {
    m.set(c.slug, c.slug)
    m.set(slugify(c.name), c.slug)
  }
  for (const [alias, target] of Object.entries(CASE_ALIASES)) {
    if (known.has(target)) m.set(alias, target)
  }
  return m
}

function buildDeviceLookup(): Map<string, string> {
  const m = new Map<string, string>()
  const known = new Set(DEVICES.map((d) => d.slug))
  for (const d of DEVICES) {
    m.set(d.slug, d.slug)
    m.set(slugify(d.name), d.slug)
    if (d.slug.startsWith("iphone-")) m.set(d.slug.slice("iphone-".length), d.slug)
    else if (d.slug.startsWith("samsung-")) m.set(d.slug.slice("samsung-".length), d.slug)
  }
  for (const [form, deviceSlug] of Object.entries(FORM_DEVICE)) {
    if (known.has(deviceSlug)) m.set(form, deviceSlug)
  }
  return m
}

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
  const deviceIdx = last((i) => deviceLookup.has(slugs[i]))
  if (deviceIdx === -1) return null
  const caseIdx = last((i) => i !== deviceIdx && caseLookup.has(slugs[i]))
  const designIdx = last(
    (i) => i !== deviceIdx && i !== caseIdx && !FORM_SEGMENTS.has(slugs[i])
  )
  if (designIdx === -1) return null
  const caseRawIdx =
    caseIdx !== -1
      ? caseIdx
      : last((i) => i !== deviceIdx && i !== designIdx && !FORM_SEGMENTS.has(slugs[i]))
  if (caseRawIdx === -1) return null
  return { caseIdx: caseRawIdx, designIdx, deviceIdx }
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i

export type AnalyzedDesign = {
  name: string
  slug: string
  caseTypes: { slug: string; images: number }[]
  images: number
}

export type FolderAnalysis = {
  designs: AnalyzedDesign[]
  /** design name -> case type slug -> device slug -> image URLs (ordered). */
  pairsByDesign: Record<string, Record<string, Record<string, string[]>>>
  skipped: number
  unmatchedCases: string[]
  unmatchedDevices: string[]
}

/**
 * Turn a flat list of R2 keys into per-design image maps. `urlOf` builds a
 * public URL from a key. Keys whose case type / device do not auto-map to the
 * store are skipped (and reported), since there is no picker on the server.
 */
export function analyzeKeys(
  keys: string[],
  urlOf: (key: string) => string
): FolderAnalysis {
  const caseLookup = buildCaseLookup()
  const deviceLookup = buildDeviceLookup()

  // design -> case slug -> device slug -> { name, url }[]
  const acc = new Map<string, Map<string, Map<string, { name: string; url: string }[]>>>()
  let skipped = 0
  const unmatchedCases = new Set<string>()
  const unmatchedDevices = new Set<string>()

  for (const key of keys) {
    const segs = key.split("/").filter(Boolean)
    const name = segs[segs.length - 1]
    if (!IMAGE_RE.test(name)) continue
    const dirs = segs.slice(0, -1)
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
    const deviceRaw = dirs[roles.deviceIdx]
    const designName = dirs[roles.designIdx]
    const caseSlug = caseLookup.get(slugify(caseRaw))
    const deviceSlug = deviceLookup.get(slugify(deviceRaw))
    if (!caseSlug) {
      unmatchedCases.add(caseRaw)
      skipped++
      continue
    }
    if (!deviceSlug) {
      unmatchedDevices.add(deviceRaw)
      skipped++
      continue
    }
    const caseMap = acc.get(designName) ?? new Map()
    const devMap = caseMap.get(caseSlug) ?? new Map()
    const list = devMap.get(deviceSlug) ?? []
    list.push({ name, url: urlOf(key) })
    devMap.set(deviceSlug, list)
    caseMap.set(caseSlug, devMap)
    acc.set(designName, caseMap)
  }

  const designs: AnalyzedDesign[] = []
  const pairsByDesign: FolderAnalysis["pairsByDesign"] = {}
  for (const [designName, caseMap] of acc) {
    pairsByDesign[designName] = {}
    let total = 0
    const caseTypes: AnalyzedDesign["caseTypes"] = []
    for (const [caseSlug, devMap] of caseMap) {
      pairsByDesign[designName][caseSlug] = {}
      let caseImages = 0
      for (const [deviceSlug, list] of devMap) {
        list.sort((a, b) => naturalCompare(a.name, b.name))
        pairsByDesign[designName][caseSlug][deviceSlug] = list.map((x) => x.url)
        caseImages += list.length
      }
      total += caseImages
      caseTypes.push({ slug: caseSlug, images: caseImages })
    }
    designs.push({ name: designName, slug: slugify(designName), caseTypes, images: total })
  }
  designs.sort((a, b) => naturalCompare(a.name, b.name))

  return {
    designs,
    pairsByDesign,
    skipped,
    unmatchedCases: [...unmatchedCases],
    unmatchedDevices: [...unmatchedDevices],
  }
}
