"use client"

import { useEffect, useState, type ComponentType } from "react"

/** Developer opt-in: no telemetry, storage, timers or observers for customers. */
export default function PerformanceAuditLoader() {
  const [Panel, setPanel] = useState<ComponentType | null>(null)
  useEffect(() => {
    let mounted = true
    if (window.location.hash === "#perf") {
      void import("./performance-audit-panel")
        .then((module) => { if (mounted) setPanel(() => module.default) })
        .catch(() => {})
    }
    return () => { mounted = false }
  }, [])
  return Panel ? <Panel /> : null
}
