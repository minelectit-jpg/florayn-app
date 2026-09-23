/**
 * The home page, header menu and footer as they stand on florayn.com, read
 * from the live site and used to seed the content tables the first time they
 * are asked for. Everything here is editable in the admin afterwards.
 *
 * Two deliberate departures from live:
 *
 *   - Style names are the taxonomy names, not the marketing labels. "Though
 *     Magsafe" (a typo) is Signature, "Elite Transparent" is Elite Clear and
 *     "Armor Transparent" is Armor Clear.
 *   - Footer "Contact Us" points at a real contact page rather than Facebook.
 */

import { SITE_IMAGES as IMG } from "./site-images"

// Clean shop paths; the old ?filter_device= form only redirects to these.
const shop = (device: string, caseType = "signature") => `/shop/${device}/${caseType}/`

/**
 * Where the home page's accessory pills and tiles lead. Watch bands and wallets
 * are case products with their own landing pages; StickPad and the phone charm
 * are single products.
 */
export const ACCESSORY_LINKS: Record<string, string> = {
  "watch bands": "/collection/watch-bands/",
  "card holder": "/collection/card-wallets/?device=Card%20Wallet",
  "magsafe wallets": "/collection/card-wallets/?device=MagSafe%20Wallet",
  "phone charms": "/product/leather-chain-phone-charm/",
  stickpad: "/product/stickpad-pro/",
  stickypad: "/product/stickpad-pro/",
  wallet: "/collection/card-wallets/",
  wallets: "/collection/card-wallets/",
}
const accessory = (label: string) => ACCESSORY_LINKS[label.toLowerCase()]

/**
 * Every home section type the storefront renders, with what its `config`
 * holds. The admin's "Add section" offers exactly these.
 *
 *   category_pills   items[]: label, href, image, note
 *   hero             slides[]: eyebrow, heading, href, cta_label, image, mobile_image
 *   marquee          items[]: short strings (falls back to the section title)
 *   tile_grid        columns (2|3|4), tiles[]: label, subtitle, href, image
 *   product_carousel limit, collection (handle; blank = newest across the store)
 *   collection_grid  slugs[] (blank = every visible landing page), limit
 *   banner           image, mobile_image (copy/CTA from the section fields)
 *   testimonials     quotes[]: name, badge, body, rating
 */
export const HOME_SECTION_TYPES = [
  "category_pills",
  "hero",
  "marquee",
  "tile_grid",
  "product_carousel",
  "collection_grid",
  "banner",
  "testimonials",
] as const

/**
 * Pictures for the seeded items, keyed by label (case-insensitive). The seed
 * uses them directly; the one-off content upgrade uses them to fill items the
 * owner has not already given a picture.
 */
export const HOME_ITEM_IMAGES: Record<string, Record<string, string>> = {
  category_pills: {
    "phone case": IMG.iconPhoneCase,
    "earbuds case": IMG.iconEarbudsCase,
    "watch bands": IMG.iconWatchBands,
    "card holder": IMG.iconCardHolder,
    "phone charms": IMG.iconPhoneCharms,
    stickpad: IMG.iconStickPad,
    "ring holder": IMG.iconRingHolder,
    "fake nails": IMG.iconFakeNails,
  },
  tile_grid: {
    "phone case": IMG.tilePhoneCase,
    "earbuds case": IMG.tileEarbudsCase,
    stickypad: IMG.tileStickPad,
    stickpad: IMG.tileStickPad,
    "phone charms": IMG.tilePhoneCharms,
    "watch bands": IMG.tileWatchBands,
    "magsafe wallets": IMG.tileMagsafeWallets,
  },
}

/** Hero slide pictures, keyed by the collection or shop path a slide opens. */
export const HERO_SLIDE_IMAGES: { match: string; image: string; mobile_image: string }[] = [
  { match: "/collection/muse-marvel", image: IMG.heroMuseMarvel, mobile_image: IMG.heroMuseMarvelMobile },
  { match: "/collection/florayn-blooms", image: IMG.heroBlooms, mobile_image: IMG.heroBloomsMobile },
  { match: "/collection/bug-life", image: IMG.heroBugLife, mobile_image: IMG.heroBugLifeMobile },
  { match: "/collection/van-gogh-dreams", image: IMG.heroVanGogh, mobile_image: IMG.heroVanGoghMobile },
  { match: "/shop/", image: IMG.heroNewest, mobile_image: IMG.heroNewestMobile },
]

const pill = (label: string, href: string | null, note?: string) => ({
  label,
  href,
  image: HOME_ITEM_IMAGES.category_pills[label.toLowerCase()] ?? null,
  ...(note ? { note } : {}),
})

const tile = (label: string, href: string) => ({
  label,
  href,
  image: HOME_ITEM_IMAGES.tile_grid[label.toLowerCase()] ?? null,
})

const slide = (eyebrow: string, heading: string, href: string, cta_label: string | null = null) => {
  const art = HERO_SLIDE_IMAGES.find((s) => href.startsWith(s.match))
  return {
    eyebrow,
    heading,
    href,
    cta_label,
    image: art?.image ?? null,
    mobile_image: art?.mobile_image ?? null,
  }
}

/** The newest-flagship slide florayn.com opens with. */
export const NEWEST_SLIDE = slide(
  "DESIGNED FOR iPHONE 17",
  "Built for the Newest",
  "/shop/iphone-17-pro-max/signature/",
  "Shop Now"
)

export const COLLECTION_GRID_SECTION = {
  key: "shop-by-collection",
  type: "collection_grid",
  is_visible: true,
  eyebrow: "Collections",
  title: "Shop by Collection",
  subtitle: "Every collection comes in every model and case type.",
  config: { slugs: [], limit: 12 },
}

export const AIRPODS_BANNER_SECTION = {
  key: "airpods-banner",
  type: "banner",
  is_visible: true,
  eyebrow: "Match your case",
  title: "AirPods Cases",
  subtitle: "Pair any design with its AirPods case.",
  cta_label: "Shop AirPods Cases",
  cta_href: "/shop/airpods-pro-3/signature-earbuds/",
  config: { image: IMG.bannerAirpods, mobile_image: null },
}

export const DEFAULT_HOME_SECTIONS = [
  {
    key: "category-pills",
    type: "category_pills",
    position: 0,
    is_visible: true,
    config: {
      items: [
        pill("Phone Case", shop("iphone-17-pro-max")),
        pill("Earbuds Case", shop("airpods-pro-3", "signature-earbuds")),
        pill("Watch Bands", accessory("Watch Bands")),
        pill("Card Holder", accessory("Card Holder")),
        pill("Phone Charms", accessory("Phone Charms")),
        pill("StickPad", accessory("StickPad")),
        pill("Ring Holder", null, "Coming Soon"),
        pill("Fake Nails", null, "Coming Soon"),
      ],
    },
  },
  {
    key: "hero",
    type: "hero",
    position: 1,
    is_visible: true,
    cta_label: "Shop Collection",
    config: {
      slides: [
        NEWEST_SLIDE,
        slide("NEW COLLECTION", "Crafted For Those Who Dare To Dream", "/collection/muse-marvel/"),
        slide("NEW COLLECTIONS", "Florayn Blooms", "/collection/florayn-blooms/"),
        // The Bug Life photo carries its own wordmark; no headline over it.
        slide("NEW COLLECTIONS", "", "/collection/bug-life/"),
        slide("NEW COLLECTIONS", "Carry A Masterpiece In Your Hands", "/collection/van-gogh-dreams/"),
      ],
    },
  },
  {
    key: "delivery-marquee",
    type: "marquee",
    position: 2,
    is_visible: true,
    title: "1–3 Days Delivery",
    config: { items: ["1–3 Days Delivery", "Cash On Delivery Across Bangladesh"] },
  },
  {
    key: "primary-tiles",
    type: "tile_grid",
    position: 3,
    is_visible: true,
    config: {
      columns: 2,
      tiles: [
        tile("Phone Case", shop("iphone-17-pro-max")),
        tile("EarBuds Case", shop("airpods-pro-3", "signature-earbuds")),
      ],
    },
  },
  {
    key: "new-releases",
    type: "product_carousel",
    position: 4,
    is_visible: true,
    title: "New Releases",
    cta_label: "See More",
    cta_href: "/collection/muse-marvel/",
    config: { limit: 5 },
  },
  { ...COLLECTION_GRID_SECTION, position: 5 },
  {
    key: "secondary-tiles",
    type: "tile_grid",
    position: 6,
    is_visible: true,
    config: {
      columns: 4,
      tiles: [
        tile("StickyPad", accessory("StickyPad")),
        tile("Phone Charms", accessory("Phone Charms")),
        tile("Watch Bands", accessory("Watch Bands")),
        tile("Magsafe Wallets", accessory("Magsafe Wallets")),
      ],
    },
  },
  { ...AIRPODS_BANNER_SECTION, position: 7 },
  {
    key: "testimonials",
    type: "testimonials",
    position: 8,
    is_visible: true,
    title: "Customer Say!",
    subtitle:
      "Customers love our products and we always strive to please them all.",
    config: {
      quotes: [
        {
          name: "Jaynab Binte Iqbal",
          badge: "Verified Buyer",
          body: "Heyyy. omg i just came home to the package. the case looks amazinggggg. and the glossy finish is so perfect. THANK YOU so much for the gifts, the pen and the lanyard. LOVE THEM SO MUCH. Thanks a lot for helping me and making my dream case come true.",
        },
        {
          name: "Mysara Rafique",
          badge: "Verified Buyer",
          body: "I'm very happy with the product, Thank you. The color and quality it really good and i will definitely order more.",
        },
        {
          name: "Rubaiya Farzana Dristy",
          badge: "Verified Buyer",
          body: "Absolutely loving my new AirPods case! Beautiful design and great quality. Would purchase again!",
        },
      ],
    },
  },
]

/**
 * The Men home page (/men), as florayn.com/men has it: its own photos and
 * shortcuts (no Phone Charms or Ring Holder), the same promises strip, and a
 * New Releases row and collection cards that the storefront fills with men's
 * designs only. Links are plain; the Men site adds /men to them itself.
 * The testimonials band is copied from the Women page when it is created.
 */
const menPill = (label: string, href: string, image: string) => ({ label, href, image })
const menTile = (label: string, href: string, image: string) => ({ label, href, image })

export const DEFAULT_MEN_HOME_SECTIONS = [
  {
    key: "men-category-pills",
    audience: "men",
    type: "category_pills",
    position: 0,
    is_visible: true,
    config: {
      items: [
        menPill("Phone Case", shop("iphone-17-pro-max"), IMG.menIconPhoneCase),
        menPill("Earbuds Case", shop("airpods-pro-3", "signature-earbuds"), IMG.menIconEarbudsCase),
        menPill("Watch Bands", accessory("Watch Bands"), IMG.menIconWatchBands),
        menPill("Card Holder", accessory("Card Holder"), IMG.menIconCardHolder),
        menPill("StickPad", accessory("StickPad"), IMG.menIconStickPad),
        menPill("Wallet", accessory("Wallet"), IMG.menIconWallet),
      ],
    },
  },
  {
    key: "men-hero",
    audience: "men",
    type: "hero",
    position: 1,
    is_visible: true,
    cta_label: "Shop Collection",
    config: {
      slides: [
        { ...NEWEST_SLIDE, image: IMG.menHeroNewest, mobile_image: IMG.menHeroNewestMobile },
        slide("NEW COLLECTIONS", "Carry A Masterpiece In Your Hands", "/collection/van-gogh-dreams/"),
      ],
    },
  },
  {
    key: "men-delivery-marquee",
    audience: "men",
    type: "marquee",
    position: 2,
    is_visible: true,
    title: "1–3 Days Delivery",
    config: { items: ["1–3 Days Delivery", "Cash On Delivery Across Bangladesh"] },
  },
  {
    key: "men-primary-tiles",
    audience: "men",
    type: "tile_grid",
    position: 3,
    is_visible: true,
    config: {
      columns: 2,
      tiles: [
        menTile("Phone Case", shop("iphone-17-pro-max"), IMG.menTilePhoneCase),
        menTile("EarBuds Case", shop("airpods-pro-3", "signature-earbuds"), IMG.menTileEarbudsCase),
      ],
    },
  },
  {
    key: "men-new-releases",
    audience: "men",
    type: "product_carousel",
    position: 4,
    is_visible: true,
    title: "New Releases",
    cta_label: "See More",
    cta_href: shop("iphone-17-pro-max"),
    config: { limit: 5 },
  },
  {
    key: "men-secondary-tiles",
    audience: "men",
    type: "tile_grid",
    position: 5,
    is_visible: true,
    config: {
      columns: 4,
      tiles: [
        menTile("StickyPad", accessory("StickyPad"), IMG.menTileStickPad),
        menTile("Wallets", accessory("Wallets"), IMG.menTileWallets),
        menTile("Watch Bands", accessory("Watch Bands"), IMG.menTileWatchBands),
        menTile("Magsafe Wallets", accessory("Magsafe Wallets"), IMG.menTileMagsafeWallets),
      ],
    },
  },
  { ...COLLECTION_GRID_SECTION, key: "men-shop-by-collection", audience: "men", position: 6 },
]

type SeedItem = {
  group?: string | null
  label: string
  href: string
  badge?: string | null
}

const iphone = (group: string, rows: [string, string, string?][]): SeedItem[] =>
  rows.map(([label, slug, badge]) => ({
    group,
    label,
    href: shop(slug),
    badge: badge ?? null,
  }))

// AirPods sell the "Signature Earbuds" construction, so their device links carry
// that case slug rather than the phone default.
const earbuds = (group: string, rows: [string, string, string?][]): SeedItem[] =>
  rows.map(([label, slug, badge]) => ({
    group,
    label,
    href: shop(slug, "signature-earbuds"),
    badge: badge ?? null,
  }))

export const DEFAULT_MENU: {
  menu: string
  label: string
  href: string | null
  items: SeedItem[]
}[] = [
  {
    menu: "primary",
    label: "Phone Case",
    href: shop("iphone-17-pro-max"),
    items: [
      ...iphone("iPhone 17 Series", [
        ["iPhone 17 Pro Max", "iphone-17-pro-max", "New"],
        ["iPhone 17 Pro", "iphone-17-pro", "New"],
        ["iPhone 17 Air", "iphone-17-air", "New"],
        ["iPhone 17", "iphone-17", "New"],
      ]),
      ...iphone("iPhone 16 Series", [
        ["iPhone 16 Pro Max", "iphone-16-pro-max"],
        ["iPhone 16 Pro", "iphone-16-pro"],
        ["iPhone 16 Plus", "iphone-16-plus"],
        ["iPhone 16", "iphone-16"],
      ]),
      ...iphone("iPhone 15 Series", [
        ["iPhone 15 Pro Max", "iphone-15-pro-max"],
        ["iPhone 15 Pro", "iphone-15-pro"],
        ["iPhone 15 Plus", "iphone-15-plus"],
        ["iPhone 15", "iphone-15"],
      ]),
      ...iphone("iPhone 14 Series", [
        ["iPhone 14 Pro Max", "iphone-14-pro-max"],
        ["iPhone 14 Pro", "iphone-14-pro"],
        ["iPhone 14 Plus", "iphone-14-plus"],
        ["iPhone 14", "iphone-14"],
      ]),
      ...iphone("iPhone 13 Series", [
        ["iPhone 13 Pro Max", "iphone-13-pro-max"],
        ["iPhone 13 Pro", "iphone-13-pro"],
        ["iPhone 13 Mini", "iphone-13-mini"],
        ["iPhone 13", "iphone-13"],
      ]),
      ...iphone("iPhone 12 Series", [
        ["iPhone 12 Pro Max", "iphone-12-pro-max"],
        ["iPhone 12 Pro", "iphone-12-pro"],
        ["iPhone 12", "iphone-12"],
      ]),
      ...iphone("Samsung S26 Series", [
        ["Samsung S26 Ultra", "samsung-s26-ultra", "New"],
        ["Samsung S26 Plus", "samsung-s26-plus", "New"],
        ["Samsung S26", "samsung-s26", "New"],
      ]),
      ...iphone("Samsung S25 Series", [
        ["Samsung S25 Ultra", "samsung-s25-ultra"],
        ["Samsung S25 Plus", "samsung-s25-plus"],
        ["Samsung S25", "samsung-s25"],
      ]),
      ...iphone("Samsung S24 Series", [
        ["Samsung S24 Ultra", "samsung-s24-ultra"],
        ["Samsung S24 Plus", "samsung-s24-plus"],
        ["Samsung S24", "samsung-s24"],
      ]),
      ...iphone("Samsung S23 Series", [
        ["Samsung S23 Ultra", "samsung-s23-ultra"],
        ["Samsung S23 Plus", "samsung-s23-plus"],
        ["Samsung S23", "samsung-s23"],
      ]),
    ],
  },
  {
    menu: "primary",
    label: "Earbuds Cases",
    href: shop("airpods-pro-3", "signature-earbuds"),
    items: earbuds("Apple", [
      ["AirPods 1/2", "airpods-1-2"],
      ["AirPods 3", "airpods-3"],
      ["AirPods 4", "airpods-4"],
      ["AirPods Pro", "airpods-pro"],
      ["AirPods Pro 2", "airpods-pro-2"],
      ["AirPods Pro 3", "airpods-pro-3", "New"],
    ]),
  },
  {
    menu: "primary",
    label: "Styles",
    href: null,
    items: [
      { label: "Alcantara", href: "/collection/alcantara/" },
      { label: "Essentials", href: "/collection/essentials/" },
      { label: "Signature", href: shop("iphone-17-pro-max", "signature") },
      { label: "Elite Clear", href: shop("iphone-17-pro-max", "elite-clear") },
      { label: "Armor Clear", href: shop("iphone-17-pro-max", "armor-clear") },
      { label: "Armor Black", href: shop("iphone-17-pro-max", "armor-black") },
    ],
  },
  {
    menu: "primary",
    label: "Collections",
    href: null,
    items: [
      { label: "Leopard", href: "/collection/leopard/" },
      { label: "Muse Marvel", href: "/collection/muse-marvel/" },
      { label: "van Gogh Dreams", href: "/collection/van-gogh-dreams/" },
      { label: "Bug Life", href: "/collection/bug-life/" },
    ],
  },
  {
    menu: "footer",
    label: "Help Customers",
    href: null,
    items: [
      {
        label:
          "Plot#H-2 (1st Floor), Block-H, Sector-2, Avenue-10, Zahurul Islam City, Dhaka-1212, Bangladesh",
        href: "/contact/",
      },
      { label: "+880 1310-007055", href: "tel:+8801310007055" },
      { label: "info@florayn.com", href: "mailto:info@florayn.com" },
    ],
  },
  {
    menu: "footer",
    label: "About",
    href: null,
    items: [
      { label: "Terms and Conditions", href: "/terms/" },
      { label: "Privacy Policy", href: "/privacy/" },
      // Live sends this to Facebook; here it is a real page.
      { label: "Contact Us", href: "/contact/" },
    ],
  },
  {
    menu: "footer",
    label: "Shop Categories",
    href: null,
    items: [
      { label: "Shop Phone Case", href: shop("iphone-17-pro-max") },
      { label: "Shop AirPods Case", href: shop("airpods-pro-3", "signature-earbuds") },
      { label: "iPhone 17 Series", href: shop("iphone-17") },
    ],
  },
  {
    menu: "footer",
    label: "Popular",
    href: null,
    items: [
      { label: "iPhone 17 Pro Max", href: shop("iphone-17-pro-max") },
      { label: "iPhone 17 Pro", href: shop("iphone-17-pro") },
      { label: "iPhone 17 Air", href: shop("iphone-17-air") },
      { label: "iPhone 16 Pro Max", href: shop("iphone-16-pro-max") },
    ],
  },
]

const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev"

/**
 * Example "Features" blocks so the band is populated the first time it renders.
 * These use real product renders as placeholders; the owner edits, replaces
 * (with an image or a looping video) or removes them from the admin.
 */
export const DEFAULT_FEATURE_BLOCKS = [
  {
    title: "Built for MagSafe",
    description:
      "A recessed magnet ring snaps to every MagSafe charger, wallet and mount — full-strength, every time.",
    image_url: `${R2}/sunburst/signature/iphone-17-pro-max/1.webp`,
    video_url: null,
    position: 0,
    is_visible: true,
  },
  {
    title: "Drop-tested protection",
    description:
      "Raised edges lift the screen and camera off the surface, with cushioned corners that take the hit for you.",
    image_url: `${R2}/timeless/signature/iphone-17-pro-max/1.webp`,
    video_url: null,
    position: 1,
    is_visible: true,
  },
  {
    title: "Printed in Dhaka",
    description:
      "Every case is printed and finished by hand in our Dhaka studio, then delivered cash-on-delivery across Bangladesh.",
    image_url: `${R2}/drift-dynasty/signature/iphone-17-pro-max/1.webp`,
    video_url: null,
    position: 2,
    is_visible: true,
  },
]

export const FOOTER_NOTE = `© ${new Date().getFullYear()} Florayn Store. All rights reserved.`
export const SOCIAL_LINKS = [
  { label: "Facebook", href: "https://www.facebook.com/FloraynFashion" },
  { label: "Instagram", href: "https://www.instagram.com/floraynfashion" },
  {
    label: "YouTube",
    href: "https://www.youtube.com/channel/UCTBJRe-E6ePw4sinG7HFAEQ",
  },
]
