"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"

import CaseTypeModal from "@/components/case-type-modal"
import { useAudience } from "@/components/use-audience"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import type { CaseTypeRecord, DeviceRecord } from "@/lib/catalog"
import { withAudience } from "@/lib/audience"
import { formForDeviceFamily } from "@/lib/product-forms"

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
  inline = false,
}: {
  deviceSlug?: string
  caseTypeSlug?: string
  devices: DeviceRecord[]
  caseTypes: CaseTypeRecord[]
  /** case type slug -> a sample render for the current device (florayn shows one). */
  inline?: boolean
  caseTypeImages?: Record<string, string>
}) {
  const router = useRouter()
  const audience = useAudience()
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
    router.push(withAudience(`/shop/${nextDevice}/${nextCase}/`, audience))
  }

  const currentForm = formForDeviceFamily(devices.find((d) => d.slug === curDevice)?.family ?? "iphone")

  // Switching models stays in this product form, including every AirPods model.
  const modelItems: ModelItem[] = useMemo(
    () =>
      devices
        .filter((d) => formForDeviceFamily(d.family) === currentForm)
        .map((d) => ({
          value: d.slug,
          label: d.name,
          group: FAMILY_LABEL[d.family] ?? d.family,
          rank: FAMILY_ORDER.indexOf(d.family),
        }))
        .sort((a, b) => (a.rank === -1 ? 99 : a.rank) - (b.rank === -1 ? 99 : b.rank))
        .map(({ rank: _rank, ...item }) => item),
    [devices, currentForm]
  )

  return (
    <div className={inline ? "contents" : "grid grid-cols-2 gap-2 sm:gap-3"}>
      <button
        type="button"
        onClick={() => setOpenModel(true)}
        className="fl-shop-filter"
      >
        <span className="min-w-0">
          <span className="fl-shop-filter__label">Model</span>
          <span className="fl-shop-filter__value">{deviceName}</span>
        </span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-muted" />
      </button>

      <button
        type="button"
        onClick={() => setOpenCase(true)}
        className="fl-shop-filter"
      >
        <span className="min-w-0">
          <span className="fl-shop-filter__label">Case type</span>
          <span className="fl-shop-filter__value">{caseName}</span>
        </span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-muted" />
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
