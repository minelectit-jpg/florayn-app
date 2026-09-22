export type RegularInput = {
  name: string; slug: string; description: string; status: "draft" | "published"
  options: { title: string; values: string[] }[]
  variants: { title: string; sku: string; price: number; stock: number; images: string[]; options: Record<string, string> }[]
}

export function imageUrls(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error("Use up to 30 images per variant.")
  return [...new Set(value.map((url) => {
    if (typeof url !== "string" || url.length > 2048 || !/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Images must use valid HTTPS URLs.")
    return url
  }))]
}

export function wholeStock(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10000000) throw new Error("Stock must be a whole number between 0 and 10,000,000.")
  return value
}

export function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error("Enter a valid BDT price with up to two decimal places.")
  return value
}

export function uploadedPairs(raw: unknown): Record<string, Record<string, string[]>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Choose at least one case type and model.")
  const result: Record<string, Record<string, string[]>> = {}
  let count = 0
  for (const [ct, models] of Object.entries(raw)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ct) || !models || typeof models !== "object" || Array.isArray(models)) throw new Error("Invalid case type or model map.")
    result[ct] = {}
    for (const [model, urls] of Object.entries(models)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(model)) throw new Error("Invalid model.")
      const images = imageUrls(urls)
      if (!images.length) throw new Error("Every model and case type needs at least one image.")
      if (++count > 2000) throw new Error("Use up to 2,000 combinations per design.")
      result[ct][model] = images
    }
  }
  if (!count) throw new Error("Choose at least one combination.")
  return result
}

export function regularInput(raw: any): RegularInput {
  if (!raw || typeof raw !== "object") throw new Error("Product details are required.")
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  if (!name || name.length > 200) throw new Error("Enter a name within 200 characters.")
  if (typeof raw.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug) || raw.slug.length > 150) throw new Error("Use a unique URL with lowercase letters, numbers and hyphens.")
  if (raw.status !== "draft" && raw.status !== "published") throw new Error("Choose Draft or Published.")
  if (typeof raw.description !== "string" || raw.description.length > 20000) throw new Error("Keep the description within 20,000 characters.")
  if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > 3) throw new Error("Use one to three product options.")
  const titles = new Set<string>()
  const options = raw.options.map((o: any) => {
    const title = typeof o?.title === "string" ? o.title.trim() : ""
    if (!title || title.length > 60 || titles.has(title) || ["Case Type", "Device", "__proto__", "constructor", "prototype"].includes(title)) throw new Error("Use unique option names. Phone cases use the case-product form.")
    titles.add(title)
    if (!Array.isArray(o.values) || !o.values.length || o.values.length > 100 || o.values.some((v: any) => typeof v !== "string" || !v.trim() || v.length > 100)) throw new Error("Each option needs valid values.")
    const values = o.values.map((v: string) => v.trim())
    if (new Set(values).size !== values.length) throw new Error("Option values must be unique.")
    return { title, values }
  })
  if (!Array.isArray(raw.variants) || !raw.variants.length || raw.variants.length > 200) throw new Error("Create between 1 and 200 variants at a time.")
  const pairs = new Set<string>()
  const skus = new Set<string>()
  const variants = raw.variants.map((v: any) => {
    if (!v?.options || Object.keys(v.options).length !== options.length) throw new Error("Every variant needs a value for each option.")
    const values = options.map((o: any) => {
      const value = v.options[o.title]
      if (!o.values.includes(value)) throw new Error(`Choose a valid ${o.title} for each variant.`)
      return value
    })
    const key = JSON.stringify(values)
    if (pairs.has(key)) throw new Error("A variant combination appears more than once.")
    pairs.add(key)
    const sku = typeof v.sku === "string" ? v.sku.trim() : ""
    if (!sku || sku.length > 100 || skus.has(sku)) throw new Error("Every variant needs a unique SKU within 100 characters.")
    skus.add(sku)
    const images = imageUrls(v.images)
    if (raw.status === "published" && !images.length) throw new Error("Add an image to every variant before publishing.")
    return { title: values.join(" / "), sku, images, options: Object.fromEntries(options.map((o: any, i: number) => [o.title, values[i]])), price: money(v.price), stock: wholeStock(v.stock) }
  })
  return { name, slug: raw.slug, description: raw.description, status: raw.status, options, variants }
}
