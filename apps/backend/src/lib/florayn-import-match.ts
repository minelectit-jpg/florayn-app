/**
 * Which product in this store an imported florayn.com line item is.
 *
 * florayn.com sold every design-and-model as its own product, named
 * "<Design> - <Model> Case" ("Lime Sorbet - iPhone 16 Pro Max Case",
 * "Grape Goo - AirPods Pro 2 Case"), and accessories as "<Colour> - StickPad
 * Pro" or "Beige Leather Chain Phone Charm". This store has one product per
 * design with Device / Case Type / Color options. So a line is matched by
 * name: the design to a product's design_name (the AirPods product for an
 * AirPods model), the model to its Device option; an accessory by its product
 * title, with the colour as its option. Pure, so it is tested on its own.
 */

export type CatalogVariant = { id: string; options: Record<string, string>; image: string | null }
export type CatalogProduct = { id: string; handle: string; title: string; designName: string; form: string | null; thumbnail: string | null; variants: CatalogVariant[] }
export type Catalog = { byDesign: Map<string, CatalogProduct[]>; byTitle: Map<string, CatalogProduct[]>; products: CatalogProduct[] }
export type LineMatch = {
  product: CatalogProduct
  /** Set only when the line names exactly one variant (a colour, or the only case type for that model). */
  variant: CatalogVariant | null
  /** The model as this store names it, for the product link (?device=). */
  device: string | null
  image: string | null
}

/** Lower-case words only: "Cherry & Co’s" -> "cherry and co s". */
export function nameKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim()
}

/** A model name compared the way both shops wrote it ("Samsung Galaxy S25 ULTRA" = "Samsung S25 Ultra"). */
export function deviceKey(value: unknown): string {
  return nameKey(value).replace(/\bgalaxy\b/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * "Lime Sorbet - iPhone 16 Pro Max Case" -> ["Lime Sorbet", "iPhone 16 Pro Max"].
 * An en/em dash always splits ("Blue Bloom –Samsung S23"); a hyphen only with a
 * space on one side, so a hyphenated name ("Ant-Man") stays whole.
 */
export function splitLineTitle(title: string): [string, string] {
  const m = String(title ?? "").match(/^(.*?)(?:\s*[–—]\s*|\s+-\s*|\s*-\s+)(.+)$/)
  if (!m) return [String(title ?? "").trim(), ""]
  return [m[1].trim(), m[2].replace(/\s+case$/i, "").trim()]
}

const push = (map: Map<string, CatalogProduct[]>, key: string, product: CatalogProduct) => {
  if (!key) return
  const list = map.get(key)
  if (list) list.push(product)
  else map.set(key, [product])
}

/**
 * Index this store's products. `products` come from Query with
 * handle, title, thumbnail, metadata and variants.options.value /
 * variants.options.option.title / variants.metadata.
 */
export function buildCatalog(products: any[]): Catalog {
  const catalog: Catalog = { byDesign: new Map(), byTitle: new Map(), products: [] }
  for (const p of products ?? []) {
    const variants: CatalogVariant[] = (p.variants ?? []).map((v: any) => ({
      id: v.id,
      options: Object.fromEntries((v.options ?? []).filter((o: any) => o?.option?.title && o.value).map((o: any) => [nameKey(o.option.title), String(o.value)])),
      image: Array.isArray(v.metadata?.images) && typeof v.metadata.images[0] === "string" ? v.metadata.images[0] : null,
    }))
    const product: CatalogProduct = {
      id: p.id,
      handle: p.handle,
      title: p.title ?? "",
      designName: (p.metadata?.design_name as string) || p.title || "",
      form: (p.metadata?.form as string) ?? null,
      thumbnail: p.thumbnail ?? null,
      variants,
    }
    catalog.products.push(product)
    push(catalog.byDesign, nameKey(product.designName), product)
    push(catalog.byTitle, nameKey(product.title), product)
  }
  return catalog
}

/**
 * The product form a florayn.com model belongs to. A design can have up to
 * four products here (phone, -airpods, -watch, -wallet) under one design name.
 */
export function modelForm(model: string): "airpods" | "watch" | "wallet" | "phone" {
  if (/\bairpods\b/i.test(model)) return "airpods"
  if (/\bwatch\b/i.test(model)) return "watch"
  if (/\bwallet\b/i.test(model)) return "wallet"
  return "phone"
}
/** A product's form, reading a missing form as a phone product. */
const formOf = (p: CatalogProduct) => (p.form ?? "phone")

/**
 * The design's product for a model: the one that actually sells that model;
 * otherwise the design's product in the model's form. Never a product of
 * another form (a phone case line never lands on the AirPods or watch product).
 */
function productForModel(designs: CatalogProduct[], model: string): CatalogProduct | undefined {
  const selling = designs.filter((p) => forModel(p, model).variants.length)
  if (selling.length) return selling.find((p) => formOf(p) === modelForm(model)) ?? selling[0]
  const form = modelForm(model)
  // "Black - StickPad Pro" is a colour and an accessory, not a design "Black".
  if (form === "phone" && !/\b(iphone|samsung|galaxy|pixel|oneplus|xiaomi|redmi)\b/i.test(model)) return undefined
  return designs.find((p) => formOf(p) === form)
}

/** The variants of `product` for a model, and the one to show (Signature first, as the shop's default case). */
function forModel(product: CatalogProduct, model: string) {
  const key = deviceKey(model)
  const variants = key ? product.variants.filter((v) => deviceKey(v.options.device) === key) : []
  const shown = variants.find((v) => /signature/i.test(v.options["case type"] ?? "")) ?? variants[0] ?? null
  return { variants, shown }
}

/** The variant whose option (colour and the like) is `value`. */
function byOptionValue(product: CatalogProduct, value: string): CatalogVariant | null {
  const key = nameKey(value)
  if (!key) return null
  return product.variants.find((v) => Object.values(v.options).some((o) => nameKey(o) === key)) ?? null
}

export function matchLine(title: string, catalog: Catalog): LineMatch | null {
  const [left, right] = splitLineTitle(title)

  // "<Design> - <Model>": the design's product that sells that model.
  if (right) {
    const designs = catalog.byDesign.get(nameKey(left)) ?? []
    const product = productForModel(designs, right)
    if (product) {
      const { variants, shown } = forModel(product, right)
      return {
        product,
        variant: variants.length === 1 ? variants[0] : null,
        device: shown?.options.device ?? null,
        image: shown?.image ?? product.thumbnail,
      }
    }
    // "<Colour> - <Accessory>": the accessory product, the colour as its option.
    const accessory = (catalog.byTitle.get(nameKey(right)) ?? catalog.byDesign.get(nameKey(right)) ?? [])[0]
    if (accessory) {
      const variant = byOptionValue(accessory, left)
      return { product: accessory, variant, device: null, image: variant?.image ?? accessory.thumbnail }
    }
  }

  // "<Colour> <Accessory title>" with no dash ("Beige Leather Chain Phone Charm").
  const whole = nameKey(title)
  const exact = (catalog.byTitle.get(whole) ?? catalog.byDesign.get(whole) ?? [])[0]
  if (exact) return { product: exact, variant: exact.variants.length === 1 ? exact.variants[0] : null, device: null, image: exact.variants[0]?.image ?? exact.thumbnail }
  // The colour may no longer be sold: the product is still the right link.
  let fallback: LineMatch | null = null
  for (const product of catalog.products) {
    const suffix = nameKey(product.title)
    if (suffix.split(" ").length < 2 || !whole.endsWith(` ${suffix}`)) continue
    const colour = whole.slice(0, whole.length - suffix.length).trim()
    const variant = byOptionValue(product, colour)
    if (variant) return { product, variant, device: null, image: variant.image ?? product.thumbnail }
    fallback ??= { product, variant: null, device: null, image: product.thumbnail }
  }
  return fallback
}
