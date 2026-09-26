/**
 * The Privacy page Florayn writes in Admin > Privacy, read with one small
 * tagged fetch (the lib/contact.ts pattern). The body is plain text: blocks
 * are separated by a blank line, "## " starts a heading and "- " a list item.
 * parsePrivacyBody turns it into blocks the page renders as React text, never
 * as HTML.
 */
import { cache } from "react"

export type PrivacyPage = {
  title: string
  body: string
  published: boolean
  updated_at: string | null
}

export type PrivacyBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }

// The backend's limits; anything larger is treated as missing.
const TITLE_MAX = 120
const BODY_MAX = 20_000

function normalizePrivacy(value: unknown): PrivacyPage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const title = typeof source.title === "string" && source.title.length <= TITLE_MAX ? source.title.trim() : ""
  const body = typeof source.body === "string" && source.body.length <= BODY_MAX ? source.body : ""
  const updated = typeof source.updated_at === "string" && Number.isFinite(Date.parse(source.updated_at))
    ? source.updated_at : null
  return { title: title || "Privacy policy", body, published: source.published === true && body.trim() !== "", updated_at: updated }
}

/** Pure: plain text to blocks. Single line breaks inside a paragraph are kept. */
export function parsePrivacyBody(body: unknown): PrivacyBlock[] {
  if (typeof body !== "string") return []
  const blocks: PrivacyBlock[] = []
  for (const block of body.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    let paragraph: string[] = []
    let items: string[] = []
    const flush = () => {
      if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") })
      if (items.length) blocks.push({ kind: "list", items })
      paragraph = []
      items = []
    }
    for (const raw of block.split("\n")) {
      const line = raw.trim()
      if (!line) continue
      // "## " and "- " markers; a marker left without text is dropped.
      if (/^##(?:\s|$)/.test(line)) {
        flush()
        const text = line.slice(2).trim()
        if (text) blocks.push({ kind: "heading", text })
      } else if (/^-(?:\s|$)/.test(line)) {
        if (paragraph.length) flush()
        const item = line.slice(1).trim()
        if (item) items.push(item)
      } else {
        if (items.length) flush()
        paragraph.push(line)
      }
    }
    flush()
  }
  return blocks
}

const BACKEND = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

/** The saved page, or null on any error so /privacy/ keeps its placeholder. */
export const getPrivacy = cache(async (): Promise<PrivacyPage | null> => {
  try {
    const response = await fetch(`${BACKEND}/store/privacy-settings`, {
      headers: { "x-publishable-api-key": KEY },
      next: { revalidate: 60, tags: ["content", "content:privacy"] },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const data: unknown = await response.json()
    const settings = data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).settings : undefined
    return normalizePrivacy(settings)
  } catch {
    return null
  }
})
