"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import Price from "@/components/price"
import type { CaseTypeRecord, DeviceRecord } from "@/lib/catalog"

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

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="relative flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] border border-line bg-paper shadow-[0_24px_60px_-20px_rgba(26,22,37,0.45)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em]">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:text-ink"
          >
            &times;
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

export default function ShopSelectors({
  deviceSlug,
  caseTypeSlug,
  devices,
  caseTypes,
}: {
  deviceSlug?: string
  caseTypeSlug?: string
  devices: DeviceRecord[]
  caseTypes: CaseTypeRecord[]
}) {
  const router = useRouter()
  const [openModel, setOpenModel] = useState(false)
  const [openCase, setOpenCase] = useState(false)
  const [query, setQuery] = useState("")

  const curDevice = deviceSlug || DEFAULT_DEVICE
  const curCase = caseTypeSlug || DEFAULT_CASE_TYPE

  const deviceName =
    devices.find((d) => d.slug === curDevice)?.name ?? "Select model"
  const caseName =
    caseTypes.find((c) => c.slug === curCase)?.name ?? "Select case type"

  function go(nextDevice: string, nextCase: string) {
    setOpenModel(false)
    setOpenCase(false)
    setQuery("")
    router.push(`/shop/${nextDevice}/${nextCase}/`)
  }

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const byFamily = new Map<string, DeviceRecord[]>()
    for (const d of devices) {
      if (needle && !d.name.toLowerCase().includes(needle)) continue
      const bucket = byFamily.get(d.family) ?? []
      bucket.push(d)
      byFamily.set(d.family, bucket)
    }
    return FAMILY_ORDER.filter((f) => byFamily.has(f)).map(
      (f) => [FAMILY_LABEL[f] ?? f, byFamily.get(f)!] as const
    )
  }, [devices, query])

  const matchCount = grouped.reduce((n, [, l]) => n + l.length, 0)

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

      {openModel ? (
        <Modal title="Select model" onClose={() => setOpenModel(false)}>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search iPhone 17 Pro Max, AirPods Pro..."
            className="field-input mb-4"
          />
          {matchCount === 0 ? (
            <p className="px-1 py-6 text-sm text-ink-muted">
              No model matches &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div className="space-y-5">
              {grouped.map(([label, list]) => (
                <div key={label}>
                  <p className="eyebrow px-1 pb-2">{label}</p>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {list.map((d) => {
                      const isCurrent = d.slug === curDevice
                      return (
                        <button
                          key={d.slug}
                          type="button"
                          onClick={() => go(d.slug, curCase)}
                          aria-pressed={isCurrent}
                          className={[
                            "rounded-[8px] border px-3 py-2 text-left text-sm transition-colors",
                            isCurrent
                              ? "border-purple bg-purple-tint text-ink"
                              : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                          ].join(" ")}
                        >
                          {d.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      {openCase ? (
        <Modal title="Select case type" onClose={() => setOpenCase(false)}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {caseTypes.map((c) => {
              const isCurrent = c.slug === curCase
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => go(curDevice, c.slug)}
                  aria-pressed={isCurrent}
                  className={[
                    "flex flex-col gap-1 rounded-[12px] border bg-surface px-4 py-4 text-left transition-colors",
                    isCurrent ? "border-purple" : "border-line hover:border-purple",
                  ].join(" ")}
                >
                  <span className="text-[15px] font-semibold">{c.name}</span>
                  <span className="text-[13px] tabular-nums text-ink-muted">
                    <Price amount={c.price} />
                  </span>
                  {c.description ? (
                    <span className="mt-1 line-clamp-3 text-[12px] leading-snug text-ink-muted">
                      {c.description}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
