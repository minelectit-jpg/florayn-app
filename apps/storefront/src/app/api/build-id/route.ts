import { NextResponse } from "next/server"

import { getBuildId } from "@/lib/build-id"

// The build id of the server currently running (from .next/BUILD_ID, stable
// across restarts — see lib/build-id.ts). force-dynamic + no-store so the answer
// is always the live deployment's id, never a cached/older one. BuildWatcher
// polls this and reloads a tab whose build no longer matches.
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    { id: getBuildId() },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  )
}
