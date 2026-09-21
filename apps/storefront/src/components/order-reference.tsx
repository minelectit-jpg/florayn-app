"use client"

import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export default function OrderReference({ reference }: { reference: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle")
  const numberRef = useRef<HTMLSpanElement>(null)
  useEffect(() => { setState("idle") }, [reference])
  useEffect(() => {
    if (state !== "copied") return
    const timer = window.setTimeout(() => setState("idle"), 2500)
    return () => window.clearTimeout(timer)
  }, [state])
  async function copy() {
    try { await navigator.clipboard.writeText(reference); setState("copied") }
    catch {
      if (numberRef.current) {
        const range = document.createRange()
        range.selectNodeContents(numberRef.current)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
      setState("manual")
    }
  }
  return <>
    <div className="order-reference"><span ref={numberRef}>{reference}</span><button type="button" onClick={copy} aria-label={state === "copied" ? "Order number copied" : "Copy order number"}>{state === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button></div>
    <span className={state === "manual" ? "order-copy-hint" : "sr-only"} role="status">{state === "copied" ? "Order number copied" : state === "manual" ? "Select and copy your order number above." : ""}</span>
  </>
}
