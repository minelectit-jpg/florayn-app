/**
 * The shopper's phone, remembered on this device only (localStorage, never
 * sent anywhere) from the shop and product pages they open, so the menu and
 * search can offer "Your phone" first. Admin > Navigation can turn it off.
 * Never read during render: read it in an effect, after hydration.
 *
 * Only phones (iPhone, Samsung) are remembered: opening an AirPods case, a
 * watch band or a wallet must never replace the phone, nor show up as
 * "Your phone". Write through phoneSlugs() / phoneOf() and read through phoneOf().
 */
const KEY = "fl_device"

/** [slug, name, family, …]: the header's device tuple (HeaderDevice). */
type DeviceTuple = readonly [slug: string, name: string, family: string, ...rest: unknown[]]

/** iPhone and Samsung are the phone form (lib/content.ts formOfFamily). */
export function isPhoneFamily(family: unknown): boolean {
  return family === "iphone" || family === "samsung"
}

/** The slugs worth remembering: phones only. */
export function phoneSlugs(devices: readonly DeviceTuple[]): string[] {
  return devices.filter((device) => isPhoneFamily(device[2])).map((device) => device[0])
}

/**
 * The phone with this slug among these devices, or null for an AirPods,
 * watch or wallet slug, an unknown one or none: a stored non-phone (from an
 * older build) then reads as no phone at all.
 */
export function phoneOf<T extends DeviceTuple>(slug: string | null, devices: readonly T[]): T | null {
  if (!slug) return null
  return devices.find((device) => device[0] === slug && isPhoneFamily(device[2])) ?? null
}

export function readDevice(): string | null {
  try {
    const value = window.localStorage.getItem(KEY)
    return value && /^[a-z0-9][a-z0-9-]{0,80}$/.test(value) ? value : null
  } catch {
    return null
  }
}

export function rememberDevice(slug: string): void {
  try {
    window.localStorage.setItem(KEY, slug)
  } catch {
    // Storage blocked (private mode): nothing to remember.
  }
}

export function forgetDevice(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing stored.
  }
}

/**
 * The device a page is about, from its path in either mode:
 * /shop/<slug>/..., or /product/<handle>-<slug>/ where the longest known slug
 * wins (iphone-15-pro-max, not iphone-15). null for any other page.
 */
export function deviceFromPath(pathname: string, slugs: string[]): string | null {
  const path = pathname.replace(/^\/men(?=\/|$)/, "") || "/"
  const shop = path.match(/^\/shop\/([a-z0-9-]+)(?:\/|$)/)
  if (shop) return slugs.includes(shop[1]) ? shop[1] : null
  const product = path.match(/^\/product\/([a-z0-9-]+)\/?$/)
  if (!product) return null
  let best: string | null = null
  for (const slug of slugs) {
    if (product[1].endsWith(`-${slug}`) && (!best || slug.length > best.length)) best = slug
  }
  return best
}
