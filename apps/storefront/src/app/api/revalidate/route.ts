import { revalidatePath, revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"

import RedisCacheHandler from "../../../../cache-handler"
import { revalidationPlan } from "@/lib/revalidation"

export const dynamic = "force-dynamic"

/** Await Redis acknowledgement so a failed invalidation can be retried safely. */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-revalidate-secret") ?? req.nextUrl.searchParams.get("secret")
  const expected = process.env.REVALIDATE_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  let plan
  try {
    const text = await req.text()
    if (text.length > 16_384) throw new Error("Request too large")
    if (text.trim()) {
      plan = revalidationPlan(JSON.parse(text))
    } else {
      const path = req.nextUrl.searchParams.get("path")
      const handle = req.nextUrl.searchParams.get("handle")
      // Preserve the existing manual refresh button. Explicit JSON {} is not a
      // global refresh; new integrations must request all:true deliberately.
      plan = revalidationPlan(path || handle
        ? { ...(path ? { paths: [path] } : {}), ...(handle ? { handles: [handle] } : {}) }
        : { all: true })
    }
  } catch {
    return NextResponse.json({ ok: false, error: "invalid revalidation request" }, { status: 400 })
  }

  try {
    await RedisCacheHandler.invalidateTags(plan.cacheTags)
    if (plan.all) revalidatePath("/", "layout")
    for (const path of plan.paths) revalidatePath(path)
    for (const tag of plan.tags) revalidateTag(tag)
    return NextResponse.json({ ok: true, all: plan.all, tags: plan.tags, paths: plan.paths })
  } catch {
    console.warn("[revalidate] cache acknowledgement failed; retry required")
    return NextResponse.json({ ok: false, error: "cache invalidation unavailable" }, { status: 503 })
  }
}
