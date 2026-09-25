import type { Audience } from "../audience"
import { compileSynonyms, modelTokens, NEUTRAL, tokenize, type CompiledSynonyms } from "./normalize"
import type { IndexForm, IndexPriceGroup, SearchIndex } from "./types"

/**
 * Search in the browser, over the index /search-index.json serves (types.ts).
 * No dependency and no request per keystroke. Catalogue text and what the
 * shopper types go through the same pipeline (normalize.ts).
 *
 * MODELS. A model's required words are its name's words without the brand
 * (iphone, samsung, apple): "iPhone 16 Pro" needs 16 and pro, "Samsung S24"
 * needs s and 24 (the s may be left out when the query says samsung), and
 * "AirPods 1/2" needs airpod and 1, 2 or 1/2. Numbers match exactly, and a
 * numbered model must have its number typed; an unnumbered one needs every
 * word. The model found covers the most required words, then leaves out the
 * fewest, then is the newest. A brand in the query must be the model's own. A
 * last word that is a number still on its way to a longer one ("1" of "15",
 * "2" of "24") is no model on its own, while typing, for Enter or on /search:
 * "1" is not AirPods 1/2, but "airpods 2" is.
 *
 * DESIGNS. Every other word must match (AND) the design's name (weight 3), its
 * collection (2), or its case types, form or category (1): exactly (3), as the
 * start of a word for the last word only (2), or with one slip (1; two from 8
 * letters; never on numbers or words of 3 letters or fewer). When nothing
 * matches every word, any word will do ("Close matches"). A found model keeps
 * only the designs made for it. Ties: this mode's designs, then both modes',
 * then the other mode's; then the ones that fit the shopper's phone; then
 * newest. One result per design, the phone case first.
 *
 * A design result is linked, priced and pictured for the model (found or
 * remembered) only where one of its styles sells it for that model (the
 * index's per-style facts), and opens on such a style.
 */

export type LinkContext = {
  /** The case type model links open on, per device family ('' = the model's first style). */
  caseType: Record<string, string>
  /** Admin link overrides per case-type slug (a "case_types" menu section). */
  style: Record<string, string>
}

type Model = { req: string[]; all: string[]; gen: number; form: string; family: string }

/** The index with its words worked out, once per session (see prepare). */
export type Prepared = {
  x: SearchIndex
  syn: CompiledSynonyms
  dv: Model[]
  /** Per product: its name's words, and the low-weight ones (case types, form, category). */
  name: string[][]
  more: string[][]
  col: string[][]
  ct: string[][]
  cat: string[][]
  /** Every catalogue word, for "Did you mean". */
  vocab: Set<string>
  /** Model numbers, to hold back a number that is still being typed. */
  nums: string[]
}

export type DesignHit = {
  /** Index into x.p. */
  p: number
  score: number
  /** The name words that matched, for <mark>. */
  marks: string[]
  /** The model (dv index) the link and picture are for, or null. */
  device: number | null
  /** The case type (ct index) the link opens on, or null. */
  ct: number | null
}

export type SearchResult = {
  /** The words that count: after synonyms, without neutral words. */
  words: string[]
  /** The model found (dv index), or null. */
  model: number | null
  /** The model found, then its generation newest first; or every model the words fit. */
  models: number[]
  designs: DesignHit[]
  /** The designs match only some of the words. */
  close: boolean
  collections: number[]
  styles: number[]
  categories: number[]
}

export type SearchOptions = {
  audience: Audience
  /** The remembered phone's slug (fl_device), if any. */
  device?: string | null
  /** Still typing: the last word may be the start of a model word. */
  typing?: boolean
  links?: LinkContext
}

const BRAND = new Set(["iphone", "samsung", "apple"])
/** Words that pin a family: "samsung 15" is no iPhone. */
const FAMILY = ["iphone", "samsung", "galaxy", "apple", "airpod"]
/** What a product form answers to, as a low-weight word ("leopard iphone"). */
const FORM_WORDS: Record<string, string[]> = {
  phone: ["iphone", "samsung", "galaxy", "apple"],
  airpods: ["airpod", "apple"],
  watch: ["watch", "band", "apple"],
  wallet: ["wallet", "card"],
}
const digit = (s: string) => /\d/.test(s)

/** iPhone and Samsung are one product form, "phone"; the others are their own. */
export function formOf(family: string): string {
  return family === "iphone" || family === "samsung" ? "phone" : family
}

const prepared = new WeakMap<SearchIndex, Prepared>()

/** Tokens for the whole index, worked out once per index (the session keeps one). */
export function prepare(x: SearchIndex): Prepared {
  const cached = prepared.get(x)
  if (cached) return cached
  const syn = compileSynonyms(x.syn)
  const words = (text: string) => tokenize(text, syn)
  const ct = x.ct.map((c) => words(c[1]))
  const cat = x.cat.map((c) => words(c[0]))
  const byHandle = new Map<string, string[]>()
  x.cat.forEach(([, href], k) => {
    const handle = href.match(/^\/product\/([^/?#]+)/)?.[1]
    if (handle) byHandle.set(handle, [...(byHandle.get(handle) ?? []), ...cat[k]])
  })
  const dv = x.dv.map(([, name, family]) => {
    const req = tokenize(name).filter((t) => !BRAND.has(t))
    const numbers = req.flatMap((t) => t.split("/")).filter((t) => /^\d+$/.test(t)).map(Number)
    return { req, all: modelTokens(name), gen: Math.max(-1, ...numbers), form: formOf(family), family }
  })
  const name = x.p.map((row) => words(row[1]))
  const more = x.p.map(([handle, , , form, , cts]) => [
    ...cts.flatMap((k) => ct[k] ?? []),
    ...(FORM_WORDS[form] ?? []),
    ...(byHandle.get(handle) ?? []),
  ])
  const col = x.col.map((c) => words(c[1]))
  const vocab = new Set([...name, ...col, ...ct, ...cat, ...dv.map((d) => d.all)].flat().filter((t) => t.length > 2 && !digit(t)))
  const nums = [...new Set(dv.flatMap((d) => d.all.filter(digit)))]
  const result: Prepared = { x, syn, dv, name, more, col, ct, cat, vocab, nums }
  prepared.set(x, result)
  return result
}

/** Damerau-Levenshtein distance (optimal string alignment). */
export function distance(a: string, b: string): number {
  const d: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    d[i] = [i]
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = i
        ? Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
          i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : 99,
        )
        : j
    }
  }
  return d[a.length][b.length]
}

function near(t: string, w: string): boolean {
  const limit = t.length > 7 ? 2 : 1
  return t.length > 3 && w.length > 3 && t[0] === w[0] && !digit(t + w) &&
    Math.abs(t.length - w.length) <= limit && distance(t, w) <= limit
}

/** How well a typed word matches a list: 3 exact, 2 start (last word only), 1 one slip; and the word. */
function match(t: string, list: string[], last: boolean): [number, string] {
  let best: [number, string] = [0, ""]
  for (const w of list) {
    const m = w === t ? 3 : last && t.length > 1 && !digit(t) && w.startsWith(t) ? 2 : near(t, w) ? 1 : 0
    if (m > best[0]) best = [m, w]
    if (m === 3) break
  }
  return best
}

/** Does a typed word stand for a model's required word? ("2" for "1/2"; "pr" for "pro" while typing it.) */
function covers(t: string, r: string, prefix: boolean): boolean {
  return t === r || (r.includes("/") && r.split("/").includes(t)) || (prefix && !digit(t + r) && r.startsWith(t))
}

type Found = { best: number | null; unique: boolean; used: Set<string> }

/** A number that is the start of a longer model number ("1" of "15"), so maybe still being typed. */
function pending(P: Prepared, t: string | undefined): boolean {
  return !!t && /^\d+$/.test(t) && P.nums.some((n) => n !== t && n.startsWith(t))
}

/**
 * The model the words name. A last word that is a number on its way to a
 * longer one ("1", "2") cannot name a model by itself; another word must cover
 * one of its required words too ("airpods 2").
 */
function detect(P: Prepared, words: string[], typing: boolean): Found {
  const samsung = words.includes("samsung") || words.includes("galaxy")
  const last = words.length - 1
  const fit = (t: string, j: number, r: string) => covers(t, r, typing && j === last)
  const held = pending(P, words[last])
  let best = -1
  let most = 0
  let fewest = 0
  let unique = true
  P.dv.forEach((d, i) => {
    if (FAMILY.some((f) => words.includes(f) && !d.all.includes(f))) return
    let hit = 0
    let miss = 0
    let numbers = true
    let other = false
    for (const r of d.req) {
      if ((r === "s" && samsung) || words.some((t, j) => fit(t, j, r))) {
        hit++
        if ((r === "s" && samsung) || words.some((t, j) => j !== last && fit(t, j, r))) other = true
      } else {
        miss++
        if (digit(r)) numbers = false
      }
    }
    if (!hit || !numbers || (d.gen < 0 && miss) || (held && !other)) return
    // dv is newest first within a family, so a tie keeps the newer one.
    if (best < 0 || hit > most || (hit === most && miss < fewest)) {
      best = i
      most = hit
      fewest = miss
      unique = true
    } else if (hit === most && miss === fewest) unique = false
  })
  if (best < 0) return { best: null, unique: false, used: new Set() }
  const d = P.dv[best]
  return {
    best,
    unique,
    used: new Set(words.filter((t, j) => (FAMILY.includes(t) && d.all.includes(t)) || d.req.some((r) => fit(t, j, r)))),
  }
}

function modelList(P: Prepared, words: string[], typing: boolean, found: Found): number[] {
  const ids = P.dv.map((_, i) => i)
  if (found.best != null) {
    const d = P.dv[found.best]
    const used = [...found.used]
    const same = ids.filter((i) => i !== found.best && P.dv[i].family === d.family && P.dv[i].gen === d.gen)
    const fits = (i: number) => Number(used.every((t) => P.dv[i].all.includes(t)))
    return [found.best, ...same.sort((a, b) => fits(b) - fits(a))]
  }
  const last = words.length - 1
  return words.length
    ? ids.filter((i) => words.every((t, j) => P.dv[i].all.some((o) => o === t || (typing && j === last && o.startsWith(t)))))
    : []
}

/** A device's price under a flat price and per-device groups. */
function groupPrice(price: number | null, groups: IndexPriceGroup[], device: number): number | null {
  return groups.find((g) => g[1].includes(device))?.[0] ?? price
}

/** Is case type k made for model d (its own devices; with none listed, its forms)? */
export function ctSells(P: Prepared, k: number, d: number): boolean {
  const [, , , forms, sold] = P.x.ct[k]
  return sold.length ? sold.includes(d) : !forms.length || forms.includes(P.dv[d].form as IndexForm)
}

/** Design p's own facts for case type k, if it has any. */
function factsOf(P: Prepared, p: number, k: number) {
  return P.x.p[p][11].find((f) => f[0] === k)
}

/** Does design p have a variant for model d in case type k? */
export function sells(P: Prepared, p: number, k: number, d: number): boolean {
  const row = P.x.p[p]
  return row[3] === P.dv[d].form && row[5].includes(k) && !row[9].includes(d) && ctSells(P, k, d) &&
    !factsOf(P, p, k)?.[1].includes(d)
}

/** What design p costs for model d in case type k: its own prices when it has them, else the case type's. */
export function pairPrice(P: Prepared, p: number, k: number, d: number): number | null {
  const facts = factsOf(P, p, k)
  if (facts?.length === 4) return groupPrice(facts[2], facts[3], d)
  const c = P.x.ct[k]
  return groupPrice(c[5], c[6], d)
}

/** Design p's prices, lowest first: for model d (over the case types that sell it), or with null for every model it is sold for. */
export function designPrices(P: Prepared, p: number, d: number | null): number[] {
  const prices = new Set<number>()
  const devices = d == null ? P.x.dv.map((_, i) => i) : [d]
  for (const k of P.x.p[p][5]) {
    for (const i of devices) {
      const price = sells(P, p, k, i) ? pairPrice(P, p, k, i) : null
      if (price != null) prices.add(price)
    }
  }
  return [...prices].sort((a, b) => a - b)
}

/**
 * The case type a design link opens on: the menu's for that family when the
 * design has it for this model, else its first that has it; null when none is
 * known to (the model's page then opens on its own first case type).
 */
function caseFor(P: Prepared, p: number, device: number, links?: LinkContext): number | null {
  const own = P.x.p[p][5]
  const wanted = links?.caseType[P.dv[device].family]
  const k = wanted ? P.x.ct.findIndex((c) => c[0] === wanted) : -1
  if (k >= 0 && sells(P, p, k, device)) return k
  return own.find((c) => sells(P, p, c, device)) ?? null
}

/** The query's words that count: after synonyms, without neutral words. */
function wordsOf(P: Prepared, q: string): string[] {
  return tokenize(q, P.syn).filter((t) => !NEUTRAL.has(t))
}

export function search(P: Prepared, q: string, o: SearchOptions): SearchResult {
  const { x } = P
  const bit = o.audience === "men" ? 2 : 1
  const typing = !!o.typing
  const words = wordsOf(P, q)
  const found = detect(P, words, typing)
  const model = found.best
  const last = words.length - 1
  const rest = words
    .map((t, j) => [t, j === last] as const)
    .filter(([t, isLast]) => !found.used.has(t) &&
      // A number still being typed ("iphone 1") is a model on its way, not a design word.
      !(typing && isLast && model == null && digit(t) && P.nums.some((n) => n.startsWith(t))))
  const remembered = o.device ? x.dv.findIndex((d) => d[0] === o.device) : -1
  const phone = model ?? (remembered < 0 ? null : remembered)
  // Design i is linked for the phone only when one of its styles sells it
  // there (or, with no style known, when it is not ruled out).
  const fits = (i: number, d: number) => {
    const row = x.p[i]
    return row[3] === P.dv[d].form && !row[9].includes(d) && (!row[5].length || row[5].some((k) => sells(P, i, k, d)))
  }

  let designs: DesignHit[] = []
  let close = false
  for (const any of [false, true]) {
    x.p.forEach((row, i) => {
      if (model != null && (row[3] !== P.dv[model].form || row[9].includes(model))) return
      let score = 0
      let hits = 0
      const marks: string[] = []
      for (const [t, isLast] of rest) {
        const [n, w] = match(t, P.name[i], isLast)
        if (n) marks.push(w)
        const s = Math.max(n * 3, match(t, row[6] >= 0 ? P.col[row[6]] ?? [] : [], isLast)[0] * 2, match(t, P.more[i], isLast)[0])
        if (s) {
          score += s
          hits++
        }
      }
      if (any ? !hits : hits < rest.length) return
      const device = phone != null && row[2] && fits(i, phone) ? phone : null
      designs.push({ p: i, score, marks, device, ct: device == null ? null : caseFor(P, i, device, o.links) })
    })
    if (designs.length || rest.length < 2) break
    close = true
  }

  const rank = (h: DesignHit) => {
    const aud = x.p[h.p][4]
    return aud === bit ? 0 : aud === 3 ? 1 : 2
  }
  designs.sort((a, b) =>
    b.score - a.score || rank(a) - rank(b) || Number(a.device == null) - Number(b.device == null) || a.p - b.p)
  const seen = new Map<string, DesignHit>()
  designs = designs.filter((h) => {
    const row = x.p[h.p]
    const key = row[2] || `#${row[0]}`
    const kept = seen.get(key)
    if (!kept) {
      seen.set(key, h)
      return true
    }
    // One result per design: the phone case, in the better place.
    if (row[3] === "phone" && x.p[kept.p][3] !== "phone") Object.assign(kept, h, { score: kept.score })
    return false
  })

  const named = (lists: string[][], ok: (k: number) => unknown) => lists
    .map((list, k) => [k, rest.reduce((s, [t, isLast]) => s + match(t, list, isLast)[0], 0)])
    .filter(([k, s]) => s && ok(k))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([k]) => k)

  return {
    words,
    model,
    models: modelList(P, words, typing, found),
    designs,
    close,
    collections: named(P.col, (k) => x.col[k][3] & bit),
    // With a model found, only the styles made for it.
    styles: named(P.ct, (k) => model == null || ctSells(P, k, model)),
    categories: named(P.cat, (k) => x.cat[k][3] & bit),
  }
}

/**
 * The model the words name, when there is exactly one and nothing else was
 * typed ("iphone 16", "15pm", "ipone 15 pro max cover"): Enter then opens its
 * shop. Neutral and brand words may ride along. A bare "1" or "2" names none.
 */
export function exactModel(P: Prepared, q: string): number | null {
  const words = wordsOf(P, q)
  const found = detect(P, words, false)
  return found.best != null && found.unique && words.every((t) => found.used.has(t) || BRAND.has(t)) ? found.best : null
}

/** The query with each unknown word swapped for the nearest catalogue word (2 edits or fewer), or null. */
export function didYouMean(P: Prepared, q: string): string | null {
  let changed = false
  const words = wordsOf(P, q).map((t) => {
    if (t.length < 3 || digit(t) || P.vocab.has(t)) return t
    let best = t
    let least = 3
    for (const w of P.vocab) {
      if (Math.abs(w.length - t.length) >= least) continue
      const d = distance(t, w)
      if (d < least) {
        best = w
        least = d
      }
    }
    if (best !== t) changed = true
    return best
  })
  return changed ? words.join(" ") : null
}

/**
 * The designs for a mode: its own and both modes'. When the mode has none but
 * the other one does, those come back with other = true, shown under a note.
 */
export function forMode(P: Prepared, designs: DesignHit[], audience: Audience): { designs: DesignHit[]; other: boolean } {
  const bit = audience === "men" ? 2 : 1
  const own = designs.filter((h) => P.x.p[h.p][4] & bit)
  return own.length || !designs.length ? { designs: own, other: false } : { designs, other: true }
}

/**
 * Where model and style links go, from one mode's menu sections: a devices
 * section's case type for each of its families (when that case type is sold
 * for the family's form), and a case_types section's link overrides.
 */
export function linkContext(
  sections: { kind?: string | null; config?: unknown }[],
  forms: Record<string, readonly string[]>,
): LinkContext {
  const caseType: Record<string, string> = {}
  const style: Record<string, string> = {}
  for (const section of sections) {
    const c = (section.config ?? {}) as { families?: string[]; case_type?: string | null; links?: Record<string, string> }
    if (section.kind === "devices") {
      for (const family of c.families ?? []) {
        if (family in caseType) continue
        const sold = c.case_type ? forms[c.case_type] : undefined
        caseType[family] = sold && (!sold.length || sold.includes(formOf(family))) ? c.case_type! : ""
      }
    }
    if (section.kind === "case_types") {
      for (const [slug, href] of Object.entries(c.links ?? {})) if (!(slug in style)) style[slug] = href
    }
  }
  return { caseType, style }
}

/** A model's shop: /shop/<model>/<case type>/ when its menu section names one, else /shop/<model>/. */
export function modelHref(slug: string, family: string, links?: LinkContext): string {
  const c = links?.caseType[family]
  return c ? `/shop/${slug}/${c}/` : `/shop/${slug}/`
}

/**
 * Model i's shop from the index: its menu section's case type only when that
 * case type is made for this very model (a Phone Case section on Elite Clear
 * never opens an empty Samsung shop), else the model's own first style.
 */
export function modelLink(P: Prepared, i: number, links?: LinkContext): string {
  const [slug, , family] = P.x.dv[i]
  const c = links?.caseType[family]
  const k = c ? P.x.ct.findIndex((row) => row[0] === c) : -1
  return k >= 0 && ctSells(P, k, i) ? `/shop/${slug}/${c}/` : `/shop/${slug}/`
}

/**
 * The model a style links to (and is priced for): the given one (found or
 * remembered) when the style is made for it; else the newest it is made for
 * in that model's form, else in phones, else in any; -1 for none.
 */
function styleModel(P: Prepared, k: number, device: number | null): number {
  const known = device != null && device >= 0 ? device : null
  if (known != null && ctSells(P, k, known)) return known
  const newest = (form?: string) => P.dv.findIndex((d, i) => (!form || d.form === form) && ctSells(P, k, i))
  for (const form of [known == null ? "phone" : P.dv[known].form, "phone"]) {
    const i = newest(form)
    if (i >= 0) return i
  }
  return newest()
}

/**
 * A case type's shop: the admin's link, else that style on the given model
 * (the one found or remembered) when it is made for it, else on the newest
 * model of that form (or a phone) it is made for. Never a shop the style has
 * nothing in.
 */
export function styleHref(P: Prepared, k: number, device: number | null, links?: LinkContext): string {
  const slug = P.x.ct[k][0]
  const own = links?.style[slug]
  if (own) return own
  const d = styleModel(P, k, device)
  return d < 0 ? "/shop/" : `/shop/${P.x.dv[d][0]}/${slug}/`
}

/** A case type's lowest price for one form (over the devices of that form it is made for), else its lowest overall. */
export function formPrice(P: Prepared, k: number, form: string): number | null {
  const [, , fromPrice, , sold, price, groups] = P.x.ct[k]
  const prices = sold
    .filter((d) => P.dv[d].form === form)
    .map((d) => groupPrice(price, groups, d))
    .filter((v): v is number => v != null)
  return prices.length ? Math.min(...prices) : fromPrice
}

/**
 * A style's "from" price, for the model its link opens (styleHref): that
 * model's own price when it is the given one, else the style's lowest in that
 * model's form. Alcantara is "from ৳3,800" as a phone case, not the ৳1,900 of
 * a card wallet.
 */
export function stylePrice(P: Prepared, k: number, device: number | null): number | null {
  const [, , fromPrice, , , price, groups] = P.x.ct[k]
  const d = styleModel(P, k, device)
  if (d < 0) return fromPrice
  return d === device ? groupPrice(price, groups, d) ?? fromPrice : formPrice(P, k, P.dv[d].form)
}

/** An index image path as a URL ('' stays ''). */
export function imageUrl(P: Prepared, path: string): string {
  return !path || /^https?:/.test(path) ? path : `${P.x.img}/${path}`
}

/** Design p's render for case type k on model d, when its renders are known ('' when not). */
export function renderUrl(P: Prepared, p: number, k: number, d: number): string {
  const row = P.x.p[p]
  const pics = row[10]
  if (!pics) return ""
  const [slug, , , , , , , folder] = P.x.ct[k]
  return `${P.x.img}/${pics === 1 ? row[2] : pics}/${folder || slug}/${P.x.dv[d][0]}/1.webp`
}

/** Design p's own picture (its thumbnail) as a URL ('' for none). */
export function thumbUrl(P: Prepared, p: number): string {
  const thumb = P.x.p[p][7]
  return typeof thumb === "string" ? imageUrl(P, thumb) : renderUrl(P, p, thumb[0], thumb[1])
}

/**
 * A design result's link and picture. For a model (found or remembered) it is
 * that model's page (/product/<handle>-<model>/?case=<style>, the style only
 * when the design has it for that model) and its render when the design's
 * renders are known, with the design's own picture as the fallback.
 */
export function designLink(P: Prepared, h: DesignHit): { href: string; src: string; fallback: string } {
  const [handle, , design] = P.x.p[h.p]
  const fallback = thumbUrl(P, h.p)
  if (h.device == null || !design) return { href: `/product/${handle}/`, src: fallback, fallback }
  const device = P.x.dv[h.device][0]
  const c = h.ct == null ? "" : P.x.ct[h.ct][0]
  return {
    href: `/product/${handle}-${device}/${c ? `?case=${c}` : ""}`,
    src: (h.ct != null && renderUrl(P, h.p, h.ct, h.device)) || fallback,
    fallback,
  }
}

/** "৳1,400". */
export function taka(amount: number): string {
  return `৳${amount.toLocaleString("en-US")}`
}

/**
 * "Wild Prints · from ৳1,400", or "for iPhone 16 Pro · from ৳1,600": with a
 * model, its lowest price for that model (over the styles that sell it).
 */
export function designMeta(P: Prepared, h: DesignHit): string {
  const row = P.x.p[h.p]
  const from = (h.device != null ? designPrices(P, h.p, h.device)[0] : undefined) ?? row[8]
  return [h.device != null ? `for ${P.x.dv[h.device][1]}` : P.x.col[row[6]]?.[1], from != null && `from ${taka(from)}`]
    .filter(Boolean)
    .join(" · ")
}

/** A name split into [text, matched] parts, whole words, for <mark>. */
export function marked(P: Prepared, text: string, marks: string[]): [string, boolean][] {
  return text.split(/(\s+)/).filter(Boolean).map((part) => [part, tokenize(part, P.syn).some((t) => marks.includes(t))])
}

/** The newest model of each family, for "Shop by phone". */
export function newestPerFamily(P: Prepared): number[] {
  const seen = new Set<string>()
  return P.x.dv.flatMap(([, , family], i) => (seen.has(family) ? [] : (seen.add(family), [i])))
}
