import { stripAudience, withAudience } from "./audience"

export const CACHE_DOMAINS =["products", "catalog", "content", "bundles", "seo", "stock"] as const

export type RevalidationPlan = { tags: string[]; paths: string[]; cacheTags: string[]; all: boolean }

function strings(value: unknown, name: string, max: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${name}`)
  }
  return [...new Set(value as string[])]
}

/** Shared contract with the backend's post-write invalidation hook. */
export function revalidationPlan(input: unknown): RevalidationPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object")
  const body = input as Record<string, unknown>
  if (Object.keys(body).some((key) => !["tags", "paths", "handles", "all"].includes(key))) {
    throw new Error("Unknown revalidation field")
  }
  if (body.all !== undefined && typeof body.all !== "boolean") throw new Error("Invalid all")
  const tags = strings(body.tags, "tags", 64)
  if (tags.some((tag) => tag.length > 200 || !/^(products|catalog|content|bundles|seo|stock)(:[a-zA-Z0-9_-]+)*$/.test(tag))) {
    throw new Error("Invalid domain tag")
  }
  const handles = strings(body.handles, "handles", 64)
  if (handles.some((handle) => handle.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(handle))) {
    throw new Error("Invalid product handle")
  }
  const requestedPaths = strings(body.paths, "paths", 32)
  if (requestedPaths.some((path) => path.length > 512 || !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]*$/.test(path) || path.includes("..") || path.startsWith("/api/") || path === "/api")) {
    throw new Error("Invalid page path")
  }
  const all = body.all === true
  if (!all && tags.length + handles.length + requestedPaths.length === 0) throw new Error("No invalidation targets")
  const mergedTags = [...new Set([...(all ? CACHE_DOMAINS : []), ...tags, ...handles.map((handle) => `product:${handle}`)])]
  // A page that exists in both modes is refreshed in both: "/shop/x/" also
  // refreshes "/men/shop/x/". Implicit pathname tags retain a trailing slash
  // when the request does.
  const modePaths = requestedPaths.flatMap((path) => {
    const women = stripAudience(path)
    const men = withAudience(women, "men")
    return men === women ? [path] : [women, men]
  })
  const paths = [...new Set(modePaths.flatMap((path) => {
    if (path === "/") return [path]
    const normalized = path.replace(/\/+$/, "")
    return [normalized, `${normalized}/`]
  }))]
  return {
    all,
    tags: mergedTags,
    paths,
    cacheTags: [...new Set([...mergedTags, ...(all ? ["_N_T_/layout"] : []), ...paths.map((path) => `_N_T_${path}`)])],
  }
}
