"use client"

import { useEffect, useState } from "react"

import { startPerformanceAudit, type PerformanceReading } from "@/lib/performance-audit"

/** Visible local diagnostic. LCP applies to document loads, not SPA navigations. */
export default function PerformanceAuditPanel() {
  const [reading, setReading] = useState<PerformanceReading | null>(null)
  useEffect(() => startPerformanceAudit(setReading), [])

  return (
    <aside id="performance-audit" aria-label="Performance diagnostics"
      className="fixed bottom-2 left-2 z-[100] max-w-[330px] rounded border bg-white p-3 font-mono text-xs text-black shadow">
      <strong>Local performance check</strong>
      <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(reading, null, 2)}</pre>
      <p>Product ready is an observed upper bound: hydrated content + decoded hero + two frames. LCP is for this document only. No data is sent.</p>
    </aside>
  )
}
