import { setTimeout as delay } from "node:timers/promises"

export type StorefrontInvalidation = {
  tags?: string[]
  paths?: string[]
  handles?: string[]
  all?: boolean
}

/** Stay inside the storefront's request/count limits during bulk imports. */
export function revalidationBatches(input: StorefrontInvalidation): StorefrontInvalidation[] {
  if (input.all) return [{ all: true }]
  if ((input.tags?.length ?? 0) <= 64 && (input.handles?.length ?? 0) <= 64 &&
      (input.paths?.length ?? 0) <= 32 && JSON.stringify(input).length < 12_000) return [input]
  const batches: StorefrontInvalidation[] = []
  for (const key of ["tags", "handles", "paths"] as const) {
    const values = [...new Set(input[key] ?? [])]
    const size = key === "paths" ? 16 : 32
    for (let start = 0; start < values.length; start += size) {
      batches.push({ [key]: values.slice(start, start + size) })
    }
  }
  return batches
}

/** Bounded, authenticated delivery. Do not put the secret in access-log URLs. */
export async function revalidateStorefront(
  input: StorefrontInvalidation | string = { all: true }
): Promise<boolean> {
  const base = process.env.STOREFRONT_URL?.replace(/\/+$/, "")
  const secret = process.env.REVALIDATE_SECRET
  if (!base || !secret) {
    console.warn("[storefront-refresh] missing configuration")
    return false
  }
  const payload = typeof input === "string" ? { paths: [input] } : input
  const batches = revalidationBatches(payload)
  if (batches.length > 1) {
    // Serial requests avoid an invalidation burst during an import.
    let success = true
    for (const batch of batches) success = (await revalidateStorefront(batch)) && success
    return success
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${base}/api/revalidate/`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", "x-revalidate-secret": secret },
        body: JSON.stringify(batches[0] ?? payload),
        signal: AbortSignal.timeout(5_000),
      })
      const result = await res.json().catch(() => null)
      if (res.ok && result?.ok === true) return true
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch {
      // Retry transport/timeouts without logging credentials or request bodies.
    }
    if (attempt < 2) await delay(250 * (attempt + 1))
  }
  console.warn("[storefront-refresh] delivery failed after bounded retries")
  return false
}

let pending: StorefrontInvalidation | undefined
let waiting: ((ok: boolean) => void)[] = []
let timer: ReturnType<typeof setTimeout> | undefined

/** Combine the burst of events from one import/save into one cache operation. */
export function queueStorefrontRevalidation(input: StorefrontInvalidation): Promise<boolean> {
  const merged = pending ?? { tags: [], paths: [], handles: [] }
  for (const key of ["tags", "paths", "handles"] as const) {
    merged[key] = [...new Set([...(merged[key] ?? []), ...(input[key] ?? [])])]
  }
  merged.all = merged.all || input.all
  pending = merged
  const completion = new Promise<boolean>((resolve) => waiting.push(resolve))
  if (!timer) {
    timer = setTimeout(() => {
      const batch = pending!
      const callbacks = waiting
      pending = undefined
      waiting = []
      timer = undefined
      void revalidateStorefront(batch).then((ok) => callbacks.forEach((resolve) => resolve(ok)))
    }, 500)
  }
  return completion
}
