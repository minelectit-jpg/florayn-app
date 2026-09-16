"use client"

import { X } from "lucide-react"
import { useEffect, useState } from "react"

import Price from "@/components/price"
import type { CaseTypeRecord } from "@/lib/catalog"
import { cn } from "@/lib/utils"

function useModalChrome(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
}

/**
 * The case-type picker - a centred modal matching florayn.com's SELECT CASE
 * TYPE exactly: close on the left, a 3-col grid of image + name + price cards
 * (active outlined near-black), the selected type's detail below, and a
 * full-width purple SELECT that confirms. On mobile it becomes a bottom sheet.
 *
 * Shared by the shop's selectors and the pack builder's "choose a design" modal.
 */
export default function CaseTypeModal({
  caseTypes,
  images,
  current,
  onClose,
  onSelect,
}: {
  caseTypes: CaseTypeRecord[]
  images: Record<string, string>
  current: string
  onClose: () => void
  onSelect: (slug: string) => void
}) {
  useModalChrome(onClose)
  const [pending, setPending] = useState(current)
  const active = caseTypes.find((c) => c.slug === pending) ?? caseTypes[0]

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="relative flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[16px] bg-white shadow-[0_24px_60px_-20px_rgba(26,22,37,0.45)] sm:max-h-[88vh] sm:rounded-[12px]">
        <div className="relative border-b border-[#ededed] px-[52px] py-4 text-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute left-4 top-1/2 grid size-6 -translate-y-1/2 place-items-center text-ink transition-opacity hover:opacity-60"
          >
            <X className="size-[18px]" strokeWidth={1.5} />
          </button>
          <p className="text-[14px] font-semibold uppercase tracking-[1.12px] text-[#111]">
            Select case type
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
          <div className="grid grid-cols-3 gap-3">
            {caseTypes.map((c) => {
              const isActive = c.slug === pending
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setPending(c.slug)}
                  aria-pressed={isActive}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-[8px] border text-center transition-colors",
                    isActive ? "border-[#111]" : "border-[#e6e6e6] hover:border-[#111]"
                  )}
                >
                  <span className="block aspect-square w-full overflow-hidden bg-[#f5f5f5]">
                    {images[c.slug] ? (
                      <img
                        src={images[c.slug]}
                        alt={c.name}
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    ) : null}
                  </span>
                  <span className="px-1.5 pb-2.5 pt-2">
                    <span className="block text-[12px] font-medium text-[#111]">
                      {c.name}
                    </span>
                    <span className="block text-[12px] text-[#111]">
                      <Price amount={c.price} />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {active ? (
            <div className="mt-5">
              <h3 className="mb-2 text-[18px] font-semibold text-[#111]">{active.name}</h3>
              {active.description ? (
                <p className="text-[13px] leading-[1.6] text-[#333]">
                  {active.description}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onSelect(pending)}
          className="w-full bg-purple py-4 text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-purple-deep"
        >
          Select
        </button>
      </div>
    </div>
  )
}
