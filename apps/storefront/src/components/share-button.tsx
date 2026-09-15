"use client"

import { Check, Share2 } from "lucide-react"
import { useState } from "react"

/**
 * The "Share" link florayn shows above the cart form: a share glyph + label in
 * grey (#444, 15px). Uses the native share sheet where available (phones),
 * otherwise copies the page link and confirms inline.
 */
export default function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink(url: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      /* Clipboard API unavailable or the document is not focused - fall back. */
    }
    try {
      const ta = document.createElement("textarea")
      ta.value = url
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  async function onShare() {
    const url = typeof window !== "undefined" ? window.location.href : ""
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        /* user dismissed the share sheet - nothing to do */
        return
      }
    }
    if (await copyLink(url)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <button
      type="button"
      onClick={onShare}
      className="mt-5 inline-flex items-center gap-2.5 text-[15px] text-[#444] transition-colors hover:text-ink"
    >
      {copied ? (
        <Check className="size-4" strokeWidth={1.6} />
      ) : (
        <Share2 className="size-4" strokeWidth={1.6} />
      )}
      {copied ? "Link copied" : "Share"}
    </button>
  )
}
