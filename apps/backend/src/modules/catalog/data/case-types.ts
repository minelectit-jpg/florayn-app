/**
 * The six case constructions Florayn sells. A design is published once per case
 * type it is offered in, and each of those is a separate product.
 *
 * Device availability is deliberately NOT declared here. It varies design by
 * design rather than by construction, so it is swept from the live catalogue
 * into design-devices.ts.
 */

export type DevicePriceGroup = {
  /** What this group covers, for the seed log and for reading this file. */
  label: string
  price: number
  devices: string[]
}

export type CaseTypeSeed = {
  slug: string
  name: string
  description: string
  sku_code: string
  /**
   * The price in BDT. Five of the six constructions are flat - every device
   * costs the same. Alcantara is the exception; see `price_groups`.
   */
  price: number
  /**
   * Per-device-group price overrides. A device named in no group falls back to
   * `price`. Only Alcantara has these: it is cut from a different amount of
   * hide per body, so a card wallet and a Pro Max shell are not the same price.
   */
  price_groups?: DevicePriceGroup[]
}

// Ordered cheapest first; this is also the order they appear in the admin.
export const CASE_TYPES: CaseTypeSeed[] = [
  {
    slug: "essentials",
    name: "Essentials",
    description:
      "A slim flexible shell with a soft-touch finish. The everyday case, and the widest device coverage we offer.",
    sku_code: "ESS",
    price: 1400,
  },
  {
    slug: "signature",
    name: "Signature",
    description:
      "Our full-wrap print finish, available across phones, AirPods, watch bands and wallets.",
    sku_code: "SIG",
    price: 1400,
  },
  {
    slug: "elite-clear",
    name: "Elite Clear",
    description:
      "Optically clear polycarbonate with a hardened anti-scratch coat, cut thin enough to disappear.",
    sku_code: "ELTCLR",
    price: 1600,
  },
  {
    slug: "armor-black",
    name: "Armor Black",
    description:
      "Dual-layer drop protection in a matte black frame. Raised lips over the camera and screen.",
    sku_code: "ARMBLK",
    price: 1950,
  },
  {
    slug: "armor-clear",
    name: "Armor Clear",
    description:
      "Shock-absorbing bumper with a rigid clear back that holds the artwork without yellowing.",
    sku_code: "ARMCLR",
    price: 1950,
  },
  {
    slug: "alcantara",
    name: "Alcantara",
    description:
      "Italian Alcantara bonded to a rigid core. Warm to hold, and it does not slip out of a pocket.",
    sku_code: "ALC",
    // Phone shells. The groups below override this for everything else.
    price: 3800,
    price_groups: [
      {
        label: "AirPods cases",
        price: 2100,
        // AirPods Max is absent on purpose: Alcantara is not made for it.
        devices: [
          "airpods-1-2",
          "airpods-3",
          "airpods-4",
          "airpods-pro",
          "airpods-pro-2",
          "airpods-pro-3",
        ],
      },
      {
        label: "MagSafe Wallet and Apple Watch Band",
        price: 2200,
        devices: ["magsafe-wallet", "apple-watch-band"],
      },
      {
        label: "Card Wallet",
        price: 1900,
        devices: ["card-wallet"],
      },
    ],
  },
]

/** What one device costs in one construction. */
export function priceForDevice(
  caseType: CaseTypeSeed,
  deviceSlug: string
): number {
  const group = caseType.price_groups?.find((g) => g.devices.includes(deviceSlug))
  return group ? group.price : caseType.price
}
