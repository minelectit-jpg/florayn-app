/**
 * The search index, as /store/search-index builds it (apps/backend/src/lib/
 * search-index.ts) and /search-index.json serves it, edge-cached. The browser
 * fetches it once, on the first sign of wanting to search, never on page load.
 *
 * Tuples keep it small (a 400-design store is <= 60 KB, <= 14 KB gzipped).
 * Bump `v` (and the storefront cache key) whenever this shape changes.
 *
 * aud is an audience mask everywhere: 1 = Women, 2 = Men, 3 = both.
 * Image paths are relative to `img` (the R2 base) when they live there;
 * anything else stays an absolute URL. '' means no image.
 *
 * What a design sells, for which model and at what price comes from its
 * variants (the backend reads them from each product's card): a case type's
 * own devices and prices are the baseline, and each product only carries
 * where it differs (facts).
 */
export type Aud = 1 | 2 | 3
export type IndexForm = "phone" | "airpods" | "watch" | "wallet" | "product"

/** [price, dv indexes]: the devices that cost this instead of the flat price. */
export type IndexPriceGroup = [price: number, devices: number[]]

/**
 * [slug, name, fromPrice, forms, sold, price, groups, folder] in case-type order.
 * fromPrice: its lowest price over every form. sold: the dv indexes it is made
 * for. price and groups: what it costs per device (a device's group price, else
 * the flat price). folder: where its renders live in a design's folder when
 * that is not its slug ('' = its slug; the AirPods earbuds renders are in
 * "signature").
 */
export type IndexCaseType = [
  slug: string,
  name: string,
  fromPrice: number | null,
  forms: IndexForm[],
  sold: number[],
  price: number | null,
  groups: IndexPriceGroup[],
  folder: string,
]
/** [slug, name, family, badge] in /store/devices order (each family newest first). */
export type IndexDevice = [slug: string, name: string, family: string, badge: string | null]
/** [slug, title, imagePath, aud] for visible collection pages, in their order. */
export type IndexCollection = [slug: string, title: string, image: string, aud: Aud]
/**
 * One case type of one product, only where it differs from the case type:
 * [ct index, the dv indexes it has no variant for (beyond notSold and the
 * devices the case type is not made for)], then, when its prices are its own,
 * [..., price, groups] read like the case type's.
 */
export type IndexCaseTypeFacts =
  | [ct: number, notSold: number[]]
  | [ct: number, notSold: number[], price: number | null, groups: IndexPriceGroup[]]
/**
 * One published product, newest first:
 * [handle, name, designSlug ('' when none), form, aud, case-type indexes (into ct),
 *  collection index (into col, or -1), thumb, fromPrice, notSold, pics, facts]
 * thumb: its thumbnail's path, or [ct, dv] when it is that render (see pics).
 * notSold: device indexes (into dv) of this product's form it is not made for.
 * pics: where its renders are: 1 = <designSlug>/<ct folder>/<device slug>/1.webp
 * under img for every variant; a string = the same under that folder; 0 = not
 * known (the thumbnail stands in).
 * facts: per case type, where it differs (IndexCaseTypeFacts).
 */
export type IndexProduct = [
  handle: string,
  name: string,
  designSlug: string,
  form: IndexForm,
  aud: Aud,
  caseTypes: number[],
  collection: number,
  thumb: string | [ct: number, device: number],
  fromPrice: number | null,
  notSold: number[],
  pics: 0 | 1 | string,
  facts: IndexCaseTypeFacts[],
]
/** [label, href, imagePath, aud]: header link sections with an href, one per href. */
export type IndexCategory = [label: string, href: string, image: string, aud: Aud]

export type SearchIndex = {
  v: 2
  img: string
  ct: IndexCaseType[]
  dv: IndexDevice[]
  col: IndexCollection[]
  p: IndexProduct[]
  cat: IndexCategory[]
  /** Admin > Search synonyms: [words, means]. */
  syn: [words: string[], means: string][]
  /** "Try" chips per mode. */
  sug: { w: string[]; m: string[] }
  /** The no-results help link: [label, href]. */
  help: [label: string, href: string]
  /** The field's placeholder. */
  ph: string
}
