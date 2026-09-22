"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"

import CaseTypeModal from "@/components/case-type-modal"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
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
  const [pending, startTransition] = useTransition()
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
    startTransition(() => router.push(`/shop/${nextDevice}/${nextCase}/`))
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
    <div className="relative grid grid-cols-2 items-stretch gap-3" aria-busy={pending}>
      {pending ? <span role="status" className="absolute -bottom-5 right-0 text-xs text-ink-muted">Updating your selection…</span> : null}
      <button
        type="button"
        onClick={() => setOpenModel(true)}
        aria-haspopup="dialog" aria-expanded={openModel} disabled={pending}
        className="flex min-w-0 items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-3 py-3 text-left sm:px-4 transition-colors hover:border-purple focus-visible:outline-2 focus-visible:outline-purple disabled:opacity-60"
      >
        <span>
          <span className="eyebrow block">Model</span>
          <span className="mt-1 block text-[13px] font-semibold leading-snug sm:text-[15px]">{deviceName}</span>
        </span>
        <span aria-hidden="true" className="text-[10px] text-ink-muted">
          &#9662;
        </span>
      </button>

      <button
        type="button"
        onClick={() => setOpenCase(true)}
        aria-haspopup="dialog" aria-expanded={openCase} disabled={pending}
        className="flex min-w-0 items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-3 py-3 text-left sm:px-4 transition-colors hover:border-purple focus-visible:outline-2 focus-visible:outline-purple disabled:opacity-60"
      >
        <span>
          <span className="eyebrow block">Case type</span>
          <span className="mt-1 block text-[13px] font-semibold leading-snug sm:text-[15px]">{caseName}</span>
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
