"use client"

import { X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import Price from "@/components/price"
import type { CaseTypeRecord, DeviceRecord } from "@/lib/catalog"
import { cn } from "@/lib/utils"

/**
 * The shop's two selectors, matching the live florayn.com UX: a "Select model"
 * button that opens a searchable, family-grouped device list, and a "Select
 * case type" button that opens a grid of the constructions with their prices.
 * Picking either navigates to the clean /shop/<device>/<case-type>/ URL, so the
 * page (and its cards) re-render scoped to the choice.
 */

const FAMILY_LABEL: Record<string, string> = {
  iphone: "iPhone",
  samsung: "Samsung Galaxy",
  airpods: "AirPods",
  watch: "Apple Watch",
  wallet: "Card Wallet",
}
const FAMILY_ORDER = ["iphone", "samsung", "airpods", "watch", "wallet"]

const DEFAULT_DEVICE = "iphone-17-pro-max"
const DEFAULT_CASE_TYPE = "signature"

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
 */
function CaseTypeModal({
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
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

export default function ShopSelectors({
  deviceSlug,
  caseTypeSlug,
  devices,
  caseTypes,
  caseTypeImages = {},
}: {
  deviceSlug?: string
  caseTypeSlug?: string
  devices: DeviceRecord[]
  caseTypes: CaseTypeRecord[]
  /** case type slug -> a sample render for the current device (florayn shows one). */
  caseTypeImages?: Record<string, string>
}) {
  const router = useRouter()
  const [openModel, setOpenModel] = useState(false)
  const [openCase, setOpenCase] = useState(false)

  const curDevice = deviceSlug || DEFAULT_DEVICE
  const curCase = caseTypeSlug || DEFAULT_CASE_TYPE

  const deviceName =
    devices.find((d) => d.slug === curDevice)?.name ?? "Select model"
  const caseName =
    caseTypes.find((c) => c.slug === curCase)?.name ?? "Select case type"

  function go(nextDevice: string, nextCase: string) {
    setOpenModel(false)
    setOpenCase(false)
    router.push(`/shop/${nextDevice}/${nextCase}/`)
  }

  // The whole catalogue as drawer items, family-grouped in FAMILY_ORDER.
  const modelItems: ModelItem[] = useMemo(
    () =>
      devices
        .map((d) => ({
          value: d.slug,
          label: d.name,
          group: FAMILY_LABEL[d.family] ?? d.family,
          rank: FAMILY_ORDER.indexOf(d.family),
        }))
        .sort((a, b) => (a.rank === -1 ? 99 : a.rank) - (b.rank === -1 ? 99 : b.rank))
        .map(({ rank: _rank, ...item }) => item),
    [devices]
  )

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <button
        type="button"
        onClick={() => setOpenModel(true)}
        className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong"
      >
        <span>
          <span className="eyebrow block">Model</span>
          <span className="text-[15px] font-medium">{deviceName}</span>
        </span>
        <span aria-hidden="true" className="text-[10px] text-ink-muted">
          &#9662;
        </span>
      </button>

      <button
        type="button"
        onClick={() => setOpenCase(true)}
        className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong"
      >
        <span>
          <span className="eyebrow block">Case type</span>
          <span className="text-[15px] font-medium">{caseName}</span>
        </span>
        <span aria-hidden="true" className="text-[10px] text-ink-muted">
          &#9662;
        </span>
      </button>

      {/* Model picker - the shared florayn SELECT MODEL drawer; picking a device
          navigates to its clean /shop URL. */}
      <ModelDrawer
        open={openModel}
        onOpenChange={setOpenModel}
        items={modelItems}
        current={curDevice}
        onSelect={(slug) => go(slug, curCase)}
      />

      {openCase ? (
        <CaseTypeModal
          caseTypes={caseTypes}
          images={caseTypeImages}
          current={curCase}
          onClose={() => setOpenCase(false)}
          onSelect={(slug) => go(curDevice, slug)}
        />
      ) : null}
    </div>
  )
}
