"use client"

import Link from "@/components/audience-link"
import { useEffect } from "react"

/**
 * Whether an error is a failed code-split chunk load. After a deploy the JS
 * bundle hashes change, so a tab opened on the old build asks for chunks that no
 * longer exist and throws here. That is transient - a reload fetches the new
 * bundle - so we recover automatically instead of showing a dead white screen.
 */
function isChunkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  const name = String(e?.name ?? "")
  const msg = String(e?.message ?? "")
  return (
    name === "ChunkLoadError" ||
    // Chromium/Firefox and Safari word this differently; cover both, plus the
    // generic Safari "Load failed" that a dead asset/chunk surfaces as.
    /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Failed to fetch dynamically imported|import\(\) failed|Importing a module script failed|error loading dynamically imported module|Unable to (load|fetch)|Load failed/i.test(
      msg
    )
  )
}

// Reload at most once per this window, so a chunk that is genuinely gone (not
// just a stale hash) shows the retry screen instead of looping forever.
const RELOAD_KEY = "fl-chunk-reload-at"
const RELOAD_COOLDOWN_MS = 15000

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (!isChunkError(error)) return
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0")
      if (Date.now() - last < RELOAD_COOLDOWN_MS) return
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {
      // sessionStorage blocked (private mode etc.) - still worth one reload.
    }
    window.location.reload()
  }, [error])

  if (isChunkError(error)) {
    // A reload is usually already in flight; keep the screen calm, not alarming,
    // and offer a manual reload in case the auto-reload was throttled.
    return (
      <div className="space-y-4 py-16">
        <p className="eyebrow">Loading</p>
        <h1 className="display text-[2.5rem] leading-tight">Refreshing…</h1>
        <p className="text-ink-muted">Loading the latest version of the store.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded-[10px] bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Reload
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-16">
      <p className="eyebrow">Error</p>
      <h1 className="display text-[2.5rem] leading-tight">Something went wrong</h1>
      <p className="text-ink-muted">
        Please try again. If it keeps happening, refresh the page.
      </p>
      <div className="flex items-center gap-4 pt-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-[10px] bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="text-sm text-ink-muted underline underline-offset-4 transition-colors hover:text-purple"
        >
          Back to the shop
        </Link>
      </div>
    </div>
  )
}
