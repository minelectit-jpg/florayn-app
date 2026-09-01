/**
 * Deterministic placeholder artwork, as an inline SVG data URI.
 *
 * The seed used to point at picsum.photos, which made the whole catalogue look
 * broken the moment that host was slow or unreachable - and it routed every
 * product image through an external round trip for pictures that never matched
 * the design anyway. These are generated from the slug, so they are stable,
 * offline, and distinct per design and case type.
 *
 * Replace them with real artwork by configuring a file provider and uploading
 * through the admin; nothing here depends on the URLs staying data URIs.
 */

function hashOf(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function initialsOf(label: string): string {
  return label
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
}

export function placeholderImage(seed: string, label: string): string {
  const hash = hashOf(seed)
  const hue = hash % 360
  const hue2 = (hue + 40 + (hash % 60)) % 360
  const initials = initialsOf(label)

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},48%,64%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2},42%,34%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="600" height="600" fill="url(#g)"/>` +
    `<circle cx="${140 + (hash % 320)}" cy="${120 + (hash % 240)}" r="${90 + (hash % 110)}" fill="#fff" fill-opacity="0.10"/>` +
    `<text x="300" y="330" font-family="Georgia, serif" font-size="150" fill="#ffffff" fill-opacity="0.9" text-anchor="middle">${initials}</text>` +
    `</svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
