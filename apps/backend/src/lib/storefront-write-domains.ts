/** Cache dependencies of admin writes; uploads alone do not publish content. */
export function storefrontWriteTags(path: string): string[] {
  const route = path.split("?")[0].replace(/\/+$/, "")
  if (/^\/admin\/content\/seo(?:\/|$)/.test(route)) return ["seo"]
  if (/^\/admin\/content(?:\/|$)/.test(route)) return ["content"]
  if (/^\/admin\/bundles(?:\/|$)/.test(route)) return ["bundles"]
  if (/^\/admin\/stock(?:\/|$)/.test(route)) return ["stock"]
  if (/^\/admin\/devices(?:\/|$)/.test(route)) return ["catalog", "products"]
  if (/^\/admin\/case-types(?:\/|$)/.test(route)) return ["catalog", "products"]
  if (route === "/admin/designs/upload") return []
  if (/^\/admin\/(designs|products|product-variants|product-collections|product-categories|price-lists|price-preferences|prices|media|wire-images|rebuild-cards)(?:\/|$)/.test(route)) {
    return ["products", "catalog"]
  }
  if (/^\/admin\/inventory-items(?:\/|$)/.test(route)) return ["stock", "products"]
  return []
}
