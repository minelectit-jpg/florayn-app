import { NextResponse } from "next/server"

// The build id of the server currently running. force-dynamic + no-store so the
// answer is always the live deployment's id, never a cached/older one - that is
// the whole point of the check. BuildWatcher polls this and reloads a tab whose
// baked-in NEXT_PUBLIC_BUILD_ID no longer matches.
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    { id: process.env.NEXT_PUBLIC_BUILD_ID ?? "" },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  )
}
