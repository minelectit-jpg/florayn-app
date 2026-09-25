import { configPayload, type SectionDraft } from "./section-input"

/*
 * Admin > Navigation and Footer links: unsaved edits. A section's fields and
 * each link's fields are kept as drafts beside the saved rows, because every
 * write reloads the rows from the server. These decide when a draft really
 * differs from what is saved, and what is left of it once a save succeeds.
 */

/**
 * JSON with every object's keys sorted, so two values compare by content.
 * Postgres jsonb hands a saved config back with its keys in its own order
 * ({form, links, exclude}), not the order the settings editor builds them in.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  ) ?? "null"
}

/**
 * A section draft as a save would store it: trimmed text, blank as none, the
 * config tidied the way the save tidies it (blank style links dropped, hidden
 * styles in any order). An edit the save would reject still counts as a change.
 */
export function sectionDraftKey(draft: SectionDraft): string {
  let config: unknown = draft.config ?? null
  try {
    config = configPayload(draft.kind, draft.config, null)
  } catch {
    // Kept as typed: it differs from the saved (valid) config.
  }
  if (config && typeof config === "object" && Array.isArray((config as { exclude?: unknown }).exclude)) {
    config = { ...config, exclude: [...(config as { exclude: string[] }).exclude].sort() }
  }
  return stableJson({
    label: (draft.label ?? "").trim(),
    href: (draft.href ?? "").trim(),
    image_url: (draft.image_url ?? "").trim(),
    badge: (draft.badge ?? "").trim(),
    kind: draft.kind,
    placement: draft.placement,
    config,
  })
}

export const sameSectionDraft = (a: SectionDraft, b: SectionDraft) => sectionDraftKey(a) === sectionDraftKey(b)

/** The editable fields of one link (menu_item). */
export type LinkDraft = { group: string | null; label: string; href: string; badge: string | null }

export const linkFields = (item: LinkDraft): LinkDraft => ({
  group: item.group ?? null,
  label: item.label,
  href: item.href,
  badge: item.badge ?? null,
})

/** The POST /admin/content/menu-items/:id body; "" clears a group or badge. */
export const linkBody = (link: LinkDraft) => ({
  label: link.label,
  href: link.href,
  group: link.group ?? "",
  badge: link.badge ?? "",
})

/** Same link once saved: the server trims every field and stores a blank group or badge as none. */
export function sameLink(a: LinkDraft, b: LinkDraft): boolean {
  const key = (link: LinkDraft) => stableJson(Object.fromEntries(Object.entries(linkBody(link)).map(([k, v]) => [k, v.trim()])))
  return key(a) === key(b)
}

/**
 * The drafts after `sent` (the draft a save was made from) was saved: the
 * draft goes, unless it was edited while the save ran. That later edit is not
 * saved, so it stays, and shows as unsaved against the freshly saved row.
 */
export function settleDraft<T>(all: Record<string, T>, id: string, sent: T, same: (a: T, b: T) => boolean): Record<string, T> {
  const now = all[id]
  if (now === undefined) return all
  if (now !== sent && !same(now, sent)) return all
  const next = { ...all }
  delete next[id]
  return next
}
