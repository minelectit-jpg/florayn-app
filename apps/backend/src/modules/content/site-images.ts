/**
 * Marketing imagery for the home page and the collection landing pages.
 *
 * These are florayn.com's own campaign photos and collection artwork, read
 * with public GETs and re-hosted in R2 under site/ as WebP (florayn.com goes
 * away at cutover, and the storefront only optimises R2 hosts). Each file name
 * carries a content hash, so a replacement is a new URL rather than a stale
 * cache entry. Only seeds and the one-off content upgrade read this; after
 * that every image is an admin-editable field.
 */

const R2 = "https://pub-1af88507922d437983ab3ffaf7336788.r2.dev/site"

export const SITE_IMAGES = {
  heroNewest: `${R2}/home/hero-newest-13b6d931.webp`,
  heroNewestMobile: `${R2}/home/hero-newest-mobile-aa4b0531.webp`,
  heroBlooms: `${R2}/home/hero-blooms-564ddd74.webp`,
  heroBloomsMobile: `${R2}/home/hero-blooms-mobile-654389d0.webp`,
  heroVanGogh: `${R2}/home/hero-van-gogh-0cc77454.webp`,
  heroVanGoghMobile: `${R2}/home/hero-van-gogh-mobile-c51a603c.webp`,
  heroMuseMarvel: `${R2}/home/hero-muse-marvel-6611fbfd.webp`,
  heroMuseMarvelMobile: `${R2}/home/hero-muse-marvel-mobile-95a4ced4.webp`,
  heroBugLife: `${R2}/home/hero-bug-life-68a39425.webp`,
  heroBugLifeMobile: `${R2}/home/hero-bug-life-mobile-19d344eb.webp`,

  iconPhoneCase: `${R2}/home/icon-phone-case-d61a7c89.webp`,
  iconEarbudsCase: `${R2}/home/icon-earbuds-case-20f66e20.webp`,
  iconWatchBands: `${R2}/home/icon-watch-bands-f2c7cb0a.webp`,
  iconCardHolder: `${R2}/home/icon-card-holder-7ae58c33.webp`,
  iconPhoneCharms: `${R2}/home/icon-phone-charms-cdf73a39.webp`,
  iconStickPad: `${R2}/home/icon-stickpad-d62350f4.webp`,
  iconRingHolder: `${R2}/home/icon-ring-holder-a593fd77.webp`,
  iconFakeNails: `${R2}/home/icon-fake-nails-5bca17af.webp`,

  tilePhoneCase: `${R2}/home/tile-phone-case-95a4ced4.webp`,
  tileEarbudsCase: `${R2}/home/tile-earbuds-case-e9ff9b58.webp`,
  tileStickPad: `${R2}/home/tile-stickpad-c6063d85.webp`,
  tilePhoneCharms: `${R2}/home/tile-phone-charms-b93b7a84.webp`,
  tileWatchBands: `${R2}/home/tile-watch-bands-98ab2be9.webp`,
  tileMagsafeWallets: `${R2}/home/tile-magsafe-wallets-bf16b4d3.webp`,

  bannerArmor: `${R2}/home/banner-armor-d0d3716e.webp`,
  bannerAirpods: `${R2}/home/banner-airpods-4430dbea.webp`,

  leopardCard: `${R2}/collections/leopard/card-bbd52b0c.webp`,
  leopardHero: `${R2}/collections/leopard/hero-53b756c6.webp`,
  leopardHeroMobile: `${R2}/collections/leopard/hero-mobile-101144bd.webp`,
  museMarvelCard: `${R2}/collections/muse-marvel/card-3037c3dc.webp`,
  museMarvelHero: `${R2}/collections/muse-marvel/hero-6797a930.webp`,
  vanGoghCard: `${R2}/collections/van-gogh-dreams/card-4ae4b56e.webp`,
  vanGoghAirpods: `${R2}/collections/van-gogh-dreams/banner-airpods-1ac965e5.webp`,
  bugLifeCard: `${R2}/collections/bug-life/card-089ca8f6.webp`,
  bugLifeAirpods: `${R2}/collections/bug-life/banner-airpods-2dacf17d.webp`,
  bloomsHero: `${R2}/collections/florayn-blooms/hero-6fe1e53d.webp`,
  bloomsHeroMobile: `${R2}/collections/florayn-blooms/hero-mobile-e4848066.webp`,
  bloomsAirpods: `${R2}/collections/florayn-blooms/banner-airpods-d689778d.webp`,
  bloomsAirpodsMobile: `${R2}/collections/florayn-blooms/banner-airpods-mobile-39f7e6e8.webp`,
  alcantaraCard: `${R2}/collections/alcantara/card-bf495789.webp`,
  alcantaraHero: `${R2}/collections/alcantara/hero-aa20a198.webp`,
  checkmateCard: `${R2}/collections/checkmate/card-300120e5.webp`,
  garageHero: `${R2}/collections/garage/hero-dcf6ac72.webp`,
  garageHeroMobile: `${R2}/collections/garage/hero-mobile-94d309f9.webp`,
} as const

/** The hand-drawn bugs scattered over the Bug Life hero on florayn.com. */
export const BUG_LIFE_DECOR = [
  `${R2}/collections/bug-life/decor-bee-236947d3.svg`,
  `${R2}/collections/bug-life/decor-butterfly-6db70265.svg`,
  `${R2}/collections/bug-life/decor-dragonfly-42b403ef.svg`,
  `${R2}/collections/bug-life/decor-ladybug-34cead13.svg`,
  `${R2}/collections/bug-life/decor-beetle-740cdd03.svg`,
  `${R2}/collections/bug-life/decor-ant-a4ab53bd.svg`,
  `${R2}/collections/bug-life/decor-sprig-da621ea9.svg`,
]
