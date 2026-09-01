/**
 * Product titles read "Design Name – Device Model" on florayn.com and
 * "Design Name - Case Type" here. Either way the card shows the design name as
 * the title and builds its own meta line, so the title has to be split.
 *
 * The split only ever happens on a dash that has whitespace on both sides.
 * A bare hyphen is part of a word - "T-Shirt", "Cox's Bazar-1", "iPhone 16e" -
 * and splitting on it would mangle the name. En dash, em dash and hyphen are
 * all accepted as separators as long as they are spaced.
 */
const SPACED_DASH = /\s+[-–—]\s+/

export function splitProductTitle(title: string): {
  design: string
  remainder: string | null
} {
  const match = SPACED_DASH.exec(title)
  if (!match) {
    return { design: title.trim(), remainder: null }
  }

  return {
    design: title.slice(0, match.index).trim(),
    remainder: title.slice(match.index + match[0].length).trim() || null,
  }
}

/**
 * The line under the title: "iPhone 17 Pro Max Case • Signature".
 *
 * The device half is only known once a device is chosen in the filter bar. A
 * product here covers every device its case type fits, so without that choice
 * the line falls back to the case type alone rather than inventing a device.
 */
export function buildMetaLine({
  device,
  caseType,
}: {
  device?: string | null
  caseType?: string | null
}): string {
  const parts: string[] = []

  if (device) {
    // "Apple Watch Band" and "Card Wallet" are already product nouns; only
    // phone and earbud models need "Case" appended.
    parts.push(/case|band|wallet/i.test(device) ? device : `${device} Case`)
  }
  if (caseType) {
    parts.push(caseType)
  }

  return parts.join(" • ")
}
