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

const shop = (device: string, caseType = "signature") =>
  `/shop/?filter_device=${device}&filter_case-type=${caseType}&filter=1`

export const DEFAULT_HOME_SECTIONS = [
  {
    key: "category-pills",
    type: "category_pills",
    position: 0,
    is_visible: true,
    config: {
      items: [
        { label: "Phone Case", href: shop("iphone-17-pro-max") },
        { label: "Earbuds Case", href: shop("airpods-pro-3") },
        { label: "Watch Bands", href: "/collection/signature/" },
        { label: "Card Holder", href: "/collection/signature/" },
        { label: "Phone Charms", href: "/collection/signature/" },
        { label: "StickPad", href: "/collection/signature/" },
        { label: "Ring Holder", href: null, note: "Coming Soon" },
        { label: "Fake Nails", href: null, note: "Coming Soon" },
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
        {
          eyebrow: "NEW COLLECTION",
          heading: "Crafted For Those Who Dare To Dream",
          href: "/collection/muse-marvel/",
        },
        {
          eyebrow: "NEW COLLECTIONS",
          heading: "Florayn Blooms",
          href: "/collection/florayn-blooms/",
        },
        {
          eyebrow: "NEW COLLECTIONS",
          heading: "Bug Life",
          href: "/collection/bug-life/",
        },
        {
          eyebrow: "NEW COLLECTIONS",
          heading: "Carry A Masterpiece In Your Hands",
          href: "/collection/van-gogh-dreams/",
        },
      ],
    },
  },
  {
    key: "delivery-marquee",
    type: "marquee",
    position: 2,
    is_visible: true,
    title: "3 To 5 Days Delivery",
  },
  {
    key: "primary-tiles",
    type: "tile_grid",
    position: 3,
    is_visible: true,
    config: {
      columns: 2,
      tiles: [
        { label: "Phone Case", href: shop("iphone-17-pro-max") },
        { label: "EarBuds Case", href: shop("airpods-pro-3") },
      ],
    },
  },
  {
    key: "secondary-tiles",
    type: "tile_grid",
    position: 4,
    is_visible: true,
    config: {
      columns: 4,
      tiles: [
        { label: "StickyPad", href: "/collection/signature/" },
        { label: "Phone Charms", href: "/collection/signature/" },
        { label: "Watch Bands", href: "/collection/signature/" },
        { label: "Magsafe Wallets", href: "/collection/signature/" },
      ],
    },
  },
  {
    key: "new-releases",
    type: "product_carousel",
    position: 5,
    is_visible: true,
    title: "New Releases",
    cta_label: "See More",
    cta_href: "/collection/muse-marvel/",
    config: { limit: 5 },
  },
  {
    key: "testimonials",
    type: "testimonials",
    position: 6,
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
    href: shop("airpods-pro-3"),
    items: iphone("Apple", [
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
      { label: "Shop AirPods Case", href: shop("airpods-pro-3") },
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

export const FOOTER_NOTE = `© ${new Date().getFullYear()} Florayn Store. All rights reserved.`
export const SOCIAL_LINKS = [
  { label: "Facebook", href: "https://www.facebook.com/FloraynFashion" },
  { label: "Instagram", href: "https://www.instagram.com/floraynfashion" },
  {
    label: "YouTube",
    href: "https://www.youtube.com/channel/UCTBJRe-E6ePw4sinG7HFAEQ",
  },
]
