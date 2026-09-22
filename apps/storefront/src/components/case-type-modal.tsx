"use client"

import { X } from "lucide-react"
import { Dialog } from "radix-ui"
import { useState } from "react"

import Price from "@/components/price"
import type { CaseTypeRecord } from "@/lib/catalog"
import { cn } from "@/lib/utils"

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
  const [pending, setPending] = useState(current)
  const active = caseTypes.find((c) => c.slug === pending) ?? caseTypes[0]

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[90] bg-ink/45" />
      <Dialog.Content aria-describedby={undefined} className="fixed bottom-0 left-1/2 z-[90] flex max-h-[90dvh] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden rounded-t-[16px] bg-white shadow-2xl outline-none sm:bottom-auto sm:top-1/2 sm:max-h-[calc(100dvh-64px)] sm:w-[calc(100%-48px)] sm:-translate-y-1/2 sm:rounded-[12px]">
        <div className="relative border-b border-[#ededed] px-[52px] py-4 text-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute left-4 top-1/2 grid size-6 -translate-y-1/2 place-items-center text-ink transition-opacity hover:opacity-60"
          >
            <X className="size-[18px]" strokeWidth={1.5} />
          </button>
          <Dialog.Title className="text-[14px] font-semibold uppercase tracking-[1.12px] text-[#111]">
            Select case type
          </Dialog.Title>
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
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
