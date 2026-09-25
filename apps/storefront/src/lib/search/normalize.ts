/**
 * The one text pipeline for model names, design names and what shoppers type,
 * shared by search (lib/search/engine.ts), the menu's model filter and the
 * product page's model picker. Catalogue text and queries go through the same
 * steps, so "iphone15promax", "15pm", "আইফোন ১৫" and "i-phone 15 pro max"
 * all meet "iPhone 15 Pro Max" halfway:
 *
 *  1. NFKD, Latin accents dropped, lower case; Bangla digits become 0-9;
 *     "+" becomes "plus"; punctuation becomes a space ("1/2" is kept).
 *  2. Letter/digit runs split ("s24u" -> "s 24 u").
 *  3. Admin synonyms (Admin > Search), longest phrase first.
 *  4. Aliases: pm / promax -> pro max, ip -> iphone, pl -> plus, and u ->
 *     ultra right after a number.
 *  5. A plural s is dropped from words longer than 3 letters ("airpods",
 *     "cases"), never from ...ss / ...us / ...is ("glass", "plus").
 *
 * No dependencies; keep it small, it ships with the menu and search chunks.
 */

export type SynonymRow = [words: string[], means: string]
export type CompiledSynonyms = { from: string[]; to: string[] }[]

/** Words that never decide a match ("iphone 15 er cover"). */
export const NEUTRAL: ReadonlySet<string> = new Set(["case", "cover", "for", "phone", "mobile", "model", "new", "the", "a", "of", "and", "er"])

const BN_DIGITS = "০১২৩৪৫৬৭৮৯"

function base(text: string): string[] {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/\+/g, " plus ")
    .replace(/(\d)\/(?=\d)/g, "$1\u0001")
    .replace(/[^\p{L}\p{M}\p{N}\u0001]+/gu, " ")
    .replace(/\u0001/g, "/")
    .replace(/(\p{L}\p{M}*)(?=\p{N})/gu, "$1 ")
    .replace(/(\p{N})(?=\p{L})/gu, "$1 ")
  return s.split(" ").filter(Boolean)
}

/** Admin synonym rows, ready for tokenize(). Longest phrases win. */
export function compileSynonyms(rows: SynonymRow[] | undefined | null): CompiledSynonyms {
  const out: CompiledSynonyms = []
  for (const [words, means] of rows ?? []) {
    const to = base(means)
    for (const word of words) {
      const from = base(word)
      if (from.length && to.length) out.push({ from, to })
    }
  }
  return out.sort((a, b) => b.from.length - a.from.length)
}

function applySynonyms(tokens: string[], synonyms: CompiledSynonyms): string[] {
  if (!synonyms.length) return tokens
  const out: string[] = []
  for (let i = 0; i < tokens.length;) {
    const hit = synonyms.find(({ from }) => from.every((t, j) => tokens[i + j] === t))
    if (hit) {
      out.push(...hit.to)
      i += hit.from.length
    } else out.push(tokens[i++])
  }
  return out
}

/** The pipeline above: text in, comparable tokens out. */
export function tokenize(text: string, synonyms: CompiledSynonyms = []): string[] {
  const out: string[] = []
  for (const token of applySynonyms(base(text), synonyms)) {
    const previous = out[out.length - 1]
    if (token === "pm" || token === "promax") out.push("pro", "max")
    else if (token === "ip") out.push("iphone")
    else if (token === "pl") out.push("plus")
    else if (token === "u" && previous && /^\d+$/.test(previous)) out.push("ultra")
    else out.push(token.length > 3 && token.endsWith("s") && !/(ss|us|is)$/.test(token) ? token.slice(0, -1) : token)
  }
  return out
}

/**
 * A model name's tokens plus what it implies: an iPhone, AirPods or Apple
 * Watch is also "apple", a Samsung is also "galaxy", and "1/2" is also "1"
 * and "2".
 */
export function modelTokens(name: string): string[] {
  const tokens = tokenize(name)
  const extra: string[] = []
  for (const t of tokens) {
    if (t.includes("/")) extra.push(...t.split("/"))
    if (t === "iphone" || t === "airpod" || t === "watch") extra.push("apple")
    if (t === "samsung") extra.push("galaxy")
  }
  return [...new Set([...tokens, ...extra])]
}

/**
 * Does a model name fit what was typed? Every typed word must be one of the
 * name's words; the last one may be the start of one, so "17 pr" already
 * finds "iPhone 17 Pro". Neutral words are ignored, and an empty query fits.
 */
export function matchesModel(name: string, query: string, synonyms?: CompiledSynonyms): boolean {
  const typed = tokenize(query, synonyms).filter((t) => !NEUTRAL.has(t))
  if (!typed.length) return true
  const own = modelTokens(name)
  return typed.every((t, i) => own.includes(t) || (i === typed.length - 1 && own.some((o) => o.startsWith(t))))
}
