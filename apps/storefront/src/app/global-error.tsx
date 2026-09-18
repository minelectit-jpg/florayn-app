"use client"

import { useEffect } from "react"

/**
 * Last-resort boundary: catches errors that escape the root layout itself, where
 * app/error.tsx cannot reach. It replaces the whole document, so it renders its
 * own <html>/<body> and uses inline styles (the site stylesheet may not be
 * mounted at this point). Like app/error.tsx it auto-recovers from a stale-bundle
 * chunk error after a deploy by reloading once.
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

const RELOAD_KEY = "fl-chunk-reload-at"
const RELOAD_COOLDOWN_MS = 15000

export default function GlobalError({
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
      // ignore
    }
    window.location.reload()
  }, [error])

  const chunk = isChunkError(error)

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f4ef",
          color: "#1a1625",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "24px", maxWidth: 460 }}>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 12px", fontWeight: 700 }}>
            {chunk ? "Refreshing…" : "Something went wrong"}
          </h1>
          <p style={{ color: "#6b6577", margin: "0 0 20px", lineHeight: 1.5 }}>
            {chunk
              ? "Loading the latest version of the store."
              : "Please try again in a moment."}
          </p>
          <button
            type="button"
            onClick={() => (chunk ? window.location.reload() : reset())}
            style={{
              background: "#1a1625",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 20px",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {chunk ? "Reload" : "Try again"}
          </button>
        </div>
      </body>
    </html>
  )
}
