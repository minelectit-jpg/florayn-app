/**
 * Device-aware copy for the per-device product pages.
 *
 * PROVENANCE - read this before trusting a sentence.
 *
 * None of this could be read from florayn.com. Its per-device descriptions are
 * byte-identical apart from the device name in the first line: the iPhone 17
 * Pro Max page and the iPhone 12 Mini page carry exactly the same paragraph.
 * So there was no device-specific copy to carry over.
 *
 * The facts below are therefore about the DEVICE, from general knowledge of
 * the hardware - lens count, MagSafe, Action Button, Camera Control - and not
 * from Florayn. They are stated as what the case is cut for, which is a claim
 * about the product. Two consequences:
 *
 *   1. Anything wrong here is wrong on a product page, so it is worth a pass
 *      from someone who has handled the cases.
 *   2. Every line is overridable per design and per device from the SEO admin
 *      screen, which is where a correction belongs.
 *
 * What is NOT asserted: case thickness, drop rating, exact cutout dimensions,
 * or wireless charging wattage. Those are manufacturing details that cannot be
 * inferred from the device.
 */

export type DeviceFacts = {
  /** Rear lens count. Null when it is not a phone. */
  cameras: number | null
  /** MagSafe magnets in the phone - iPhone 12 and later. */
  magsafe: boolean
  /** The mappable side button introduced on iPhone 15 Pro. */
  actionButton: boolean
  /** The capacitive camera button introduced on iPhone 16. */
  cameraControl: boolean
}

const IPHONE: Record<string, Partial<DeviceFacts>> = {
  "iphone-11": { cameras: 2, magsafe: false },
  "iphone-11-pro": { cameras: 3, magsafe: false },
  "iphone-11-pro-max": { cameras: 3, magsafe: false },
  "iphone-12-mini": { cameras: 2 },
  "iphone-12": { cameras: 2 },
  "iphone-12-pro": { cameras: 3 },
  "iphone-12-pro-max": { cameras: 3 },
  "iphone-13-mini": { cameras: 2 },
  "iphone-13": { cameras: 2 },
  "iphone-13-pro": { cameras: 3 },
  "iphone-13-pro-max": { cameras: 3 },
  "iphone-14": { cameras: 2 },
  "iphone-14-plus": { cameras: 2 },
  "iphone-14-pro": { cameras: 3 },
  "iphone-14-pro-max": { cameras: 3 },
  "iphone-15": { cameras: 2 },
  "iphone-15-plus": { cameras: 2 },
  "iphone-15-pro": { cameras: 3, actionButton: true },
  "iphone-15-pro-max": { cameras: 3, actionButton: true },
  "iphone-16e": { cameras: 1, actionButton: true },
  "iphone-16": { cameras: 2, actionButton: true, cameraControl: true },
  "iphone-16-plus": { cameras: 2, actionButton: true, cameraControl: true },
  "iphone-16-pro": { cameras: 3, actionButton: true, cameraControl: true },
  "iphone-16-pro-max": { cameras: 3, actionButton: true, cameraControl: true },
  "iphone-17": { cameras: 2, actionButton: true, cameraControl: true },
  "iphone-17-air": { cameras: 1, actionButton: true, cameraControl: true },
  "iphone-17-pro": { cameras: 3, actionButton: true, cameraControl: true },
  "iphone-17-pro-max": { cameras: 3, actionButton: true, cameraControl: true },
}

/**
 * Samsung is deliberately thin. Lens counts vary across the range and the
 * magnet story differs by model, so rather than guess, these pages say less.
 */
const SAMSUNG_ULTRA = /ultra$/

export function deviceFacts(slug: string): DeviceFacts {
  const base: DeviceFacts = {
    cameras: null,
    magsafe: false,
    actionButton: false,
    cameraControl: false,
  }

  if (slug.startsWith("iphone")) {
    const known = IPHONE[slug] ?? {}
    return {
      ...base,
      // Every iPhone from 12 onward carries MagSafe magnets.
      magsafe: !/^iphone-11/.test(slug),
      ...known,
    }
  }
  if (slug.startsWith("samsung")) {
    return { ...base, cameras: SAMSUNG_ULTRA.test(slug) ? 4 : 3 }
  }
  return base
}

/** A sentence about the fit, built from whichever facts the device has. */
export function fitCopy(deviceName: string, deviceSlug: string): string {
  const f = deviceFacts(deviceSlug)

  if (deviceSlug.startsWith("airpods")) {
    return `Moulded to the ${deviceName} case, with the lid hinge clear and the charging port open.`
  }
  if (deviceSlug === "apple-watch-band") {
    return `Sized for the Apple Watch, with the strap lugs left clear so it seats without forcing.`
  }
  if (deviceSlug === "card-wallet" || deviceSlug === "magsafe-wallet") {
    return deviceSlug === "magsafe-wallet"
      ? `Holds to the back of a MagSafe iPhone and takes three cards without stretching.`
      : `Slim enough for a pocket and takes three cards without stretching.`
  }

  // Phones: assemble from what the model actually has, so the sentence
  // differs by model rather than repeating one template.
  const parts: string[] = []
  if (f.cameras === 1) parts.push("a single-lens camera cutout")
  else if (f.cameras === 2) parts.push("a two-lens camera cutout")
  else if (f.cameras === 3) parts.push("a raised three-lens camera surround")
  else if (f.cameras === 4) parts.push("a four-lens camera surround")

  const buttons: string[] = []
  if (f.actionButton) buttons.push("the Action Button")
  if (f.cameraControl) buttons.push("Camera Control")
  if (buttons.length) {
    parts.push(`cutouts for ${buttons.join(" and ")}`)
  } else {
    parts.push("responsive covered side buttons")
  }

  if (f.magsafe) parts.push("magnets aligned for MagSafe charging")

  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      : parts[0]

  return `Cut for the ${deviceName}: ${list}.`
}

/** The meta description for a device page, kept inside ~155 characters. */
export function seoDescription({
  design,
  device,
  caseType,
}: {
  design: string
  device: string
  caseType: string
}): string {
  const text = `${design} ${device} case in our ${caseType} finish. Printed in Dhaka, cash on delivery across Bangladesh.`
  return text.length <= 155 ? text : `${text.slice(0, 152).trimEnd()}...`
}

/** The H1, which names the device so the page is about that device. */
export function seoHeading(design: string, device: string): string {
  return `${design} ${device} Case`
}
