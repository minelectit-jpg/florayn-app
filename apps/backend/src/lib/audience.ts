/**
 * Who a design (or a simple product's colour) is for, stored as
 * metadata.audience: "women", "men" or "both". Missing means "both", so an
 * untagged product shows on both the Women site and the Men site (/men).
 */
export const AUDIENCE_TAGS = ["women", "men", "both"] as const
export type AudienceTag = (typeof AUDIENCE_TAGS)[number]

export function isAudienceTag(value: unknown): value is AudienceTag {
  return typeof value === "string" && (AUDIENCE_TAGS as readonly string[]).includes(value)
}

/** The tag in a metadata object; anything missing or unknown is "both". */
export function readAudienceTag(metadata: unknown): AudienceTag {
  const value = (metadata as Record<string, unknown> | null | undefined)?.audience
  return value === "women" || value === "men" ? value : "both"
}

/** One tag for several products of a design: agreeing tags win, a mix is "both". */
export function mergeAudienceTags(tags: AudienceTag[]): AudienceTag {
  const unique = [...new Set(tags)]
  return unique.length === 1 ? unique[0] : "both"
}
