"use client"

import { ChevronDown, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import CaseTypeModal from "@/components/case-type-modal"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import Price from "@/components/price"
import ProductImage from "@/components/product-image"
import type { CaseTypeRecord } from "@/lib/catalog"

/**
 * The "CHOOSE A DESIGN" modal florayn opens from a pack slot: a searchable grid
 * of designs. MODEL opens the same SELECT MODEL drawer the shop uses, and CASE
 * TYPE the same SELECT CASE TYPE popup, so a pack item can be any model /
 * construction (defaulting to the base item's). Each pick carries its own
 * device, case type and price, so a mixed pack still totals correctly.
 *
 * The catalogue is prepared on the server and passed in (`designs`) rather than
 * fetched here - the backend does not allow cross-origin browser calls.
 */
export type PackDesign = {
  handle: string
  name: string
  thumbnail: string | null
  /** "<Device>|<Case Type>" -> the variant sold for that exact pair. */
  variants: Record<string, { variantId: string; price: number; image: string | null }>
}

export type PickedDesign = {
  handle: string
  designName: string
  variantId: string
  price: number
  image: string | null
  device: string
  caseType: string
}

const FAMILY_ORDER = [
  "iPhone",
  "Samsung Galaxy",
  "AirPods",
  "Apple Watch",
  "Card Wallet",
  "Other",
]

function familyOf(name: string): string {
  const n = name.toLowerCase()
  if (n.includes("iphone")) return "iPhone"
  if (n.includes("galaxy") || n.includes("samsung")) return "Samsung Galaxy"
  if (n.includes("airpods")) return "AirPods"
  if (n.includes("watch")) return "Apple Watch"
  if (n.includes("wallet") || n.includes("card")) return "Card Wallet"
  return "Other"
}

export default function ChooseDesignModal({
  open,
  onClose,
  designs,
  device,
  caseType,
  deviceOptions,
  caseTypes,
  excludeHandles,
  onPick,
  slotLabel,
}: {
  open: boolean
  onClose: () => void
  designs: PackDesign[]
  /** The base item's model + construction; the pickers default here. */
  device: string
  caseType: string
  /** All models the drawer can offer (device names, catalogue order). */
  deviceOptions: string[]
  /** All constructions the case-type popup can offer. */
  caseTypes: CaseTypeRecord[]
  /** Handles already in the pack (base + picked), so they are not offered again. */
  excludeHandles: string[]
  onPick: (design: PickedDesign) => void
  /** e.g. "1/2" progress shown top-left, matching florayn. */
  slotLabel?: string
}) {
  const [query, setQuery] = useState("")
  const [selDevice, setSelDevice] = useState(device)
  const [selCase, setSelCase] = useState(caseType)
  const [openModel, setOpenModel] = useState(false)
  const [openCase, setOpenCase] = useState(false)

  // Re-anchor the pickers to the base item whenever it changes / the modal
  // (re)opens.
  useEffect(() => {
    if (open) {
      setSelDevice(device)
      setSelCase(caseType)
      setQuery("")
    }
  }, [open, device, caseType])

  // Close on Escape and lock the page scroll while open.
  useEffect(() => {
    if (!open) return
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
  }, [open, onClose])

  const exclude = useMemo(() => new Set(excludeHandles), [excludeHandles])

  const modelItems: ModelItem[] = useMemo(
    () =>
      deviceOptions
        .map((name) => ({ value: name, label: name, group: familyOf(name) }))
        .sort((a, b) => {
          const ga = FAMILY_ORDER.indexOf(a.group)
          const gb = FAMILY_ORDER.indexOf(b.group)
          return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb)
        }),
    [deviceOptions]
  )

  const slugByName = useMemo(
    () => new Map(caseTypes.map((c) => [c.name, c.slug])),
    [caseTypes]
  )
  const nameBySlug = useMemo(
    () => new Map(caseTypes.map((c) => [c.slug, c.name])),
    [caseTypes]
  )

  // A representative render per case type on the selected device, for the popup.
  const caseTypeImages = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of caseTypes) {
      const key = `${selDevice}|${c.name}`
      const hit = designs.find((d) => d.variants[key]?.image)
      if (hit) map[c.slug] = hit.variants[key]!.image as string
    }
    return map
  }, [caseTypes, designs, selDevice])

  const options = useMemo(() => {
    const key = `${selDevice}|${selCase}`
    const needle = query.trim().toLowerCase()
    const out: PickedDesign[] = []
    for (const d of designs) {
      if (exclude.has(d.handle)) continue
      const v = d.variants[key]
      if (!v) continue
      if (needle && !d.name.toLowerCase().includes(needle)) continue
      out.push({
        handle: d.handle,
        designName: d.name,
        variantId: v.variantId,
        price: v.price,
        image: v.image,
        device: selDevice,
        caseType: selCase,
      })
    }
    return out
  }, [designs, query, selDevice, selCase, exclude])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="relative flex max-h-[88vh] w-full max-w-[900px] flex-col overflow-hidden rounded-t-[16px] bg-white shadow-[0_24px_60px_-20px_rgba(26,22,37,0.45)] sm:max-h-[82vh] sm:rounded-[14px]">
        <div className="relative flex items-center justify-center border-b border-[#ededed] px-[52px] py-4">
          {slotLabel ? (
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[13px] tabular-nums text-ink-muted">
              {slotLabel}
            </span>
          ) : null}
          <p className="text-[14px] font-semibold uppercase tracking-[1.12px] text-[#111]">
            Choose a design
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-1/2 grid size-6 -translate-y-1/2 place-items-center text-ink transition-opacity hover:opacity-60"
          >
            <X className="size-[18px]" strokeWidth={1.5} />
          </button>
        </div>

        {/* Filters: search + the shop's model drawer + case-type popup triggers. */}
        <div className="grid gap-3 border-b border-[#f0eef4] p-[18px] sm:grid-cols-[1fr_auto_auto]">
          <label className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
            <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={1.6} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a design"
              className="w-full border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
          <FilterTrigger
            label="Model"
            value={selDevice}
            onClick={() => setOpenModel(true)}
          />
          <FilterTrigger
            label="Case type"
            value={selCase}
            onClick={() => setOpenCase(true)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
          {options.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-muted">
              No other design matches{query ? ` “${query}”` : ""} for {selDevice} · {selCase}.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {options.map((d) => (
                <div
                  key={d.handle}
                  className="flex flex-col overflow-hidden rounded-[12px] border border-[#eceaf1] bg-surface"
                >
                  <span className="relative block aspect-[3/4] w-full overflow-hidden bg-[#f6f5f8]">
                    <ProductImage
                      src={d.image}
                      alt={d.designName}
                      label={d.designName}
                      sizes="220px"
                    />
                  </span>
                  <div className="flex flex-1 flex-col p-3 text-center">
                    <span className="text-[15px] font-semibold text-[#111]">
                      {d.designName}
                    </span>
                    <span className="mt-0.5 text-[12px] text-ink-muted">
                      {d.device} · {d.caseType}
                    </span>
                    <span className="mt-1 text-[14px] tabular-nums text-[#111]">
                      <Price amount={d.price} />
                    </span>
                    <button
                      type="button"
                      onClick={() => onPick(d)}
                      className="mt-2.5 rounded-[8px] border border-line-strong py-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Model: the shared florayn SELECT MODEL drawer. */}
      <ModelDrawer
        open={openModel}
        onOpenChange={setOpenModel}
        items={modelItems}
        current={selDevice}
        onSelect={(name) => {
          setSelDevice(name)
          setOpenModel(false)
        }}
      />

      {/* Case type: the shared florayn SELECT CASE TYPE popup. */}
      {openCase ? (
        <CaseTypeModal
          caseTypes={caseTypes}
          images={caseTypeImages}
          current={slugByName.get(selCase) ?? caseTypes[0]?.slug ?? ""}
          onClose={() => setOpenCase(false)}
          onSelect={(slug) => {
            setSelCase(nameBySlug.get(slug) ?? selCase)
            setOpenCase(false)
          }}
        />
      ) : null}
    </div>
  )
}

/** A florayn-style labelled box that opens a picker. */
function FilterTrigger({
  label,
  value,
  onClick,
}: {
  label: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[160px] items-center gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-1.5 text-left transition-colors hover:border-line-strong"
    >
      <span className="flex flex-col">
        <span className="eyebrow">{label}</span>
        <span className="text-[14px] font-medium">{value}</span>
      </span>
      <ChevronDown className="ml-auto size-4 text-ink-muted" strokeWidth={1.6} />
    </button>
  )
}
