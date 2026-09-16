"use client"

import { ChevronDown, Plus, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import ChooseDesignModal, {
  type PackDesign,
  type PickedDesign,
} from "@/components/choose-design-modal"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import ProductImage from "@/components/product-image"
import { Spinner } from "@/components/ui/button"
import { useCart } from "@/components/cart-provider"
import { tierPricing, type BundleConfig } from "@/lib/bundles"
import type { CaseTypeRecord } from "@/lib/catalog"
import { cn } from "@/lib/utils"

/** Compact BDT, no decimals - florayn's pack widget style ("2,500৳"). */
function bdt(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")}৳`
}

/**
 * The florayn "GET MORE SAVE MORE" pack selector: Single / 2-pack / 3-pack pills
 * with struck-through and discounted totals, then (for a multi pack) a row of
 * slots the customer fills with any design in the same model + construction, a
 * progress bar, and a CTA that adds the whole pack at once. The discount is
 * shown here from the tier config; the backend re-computes and applies it to the
 * cart, so this is a promise the checkout keeps, never the source of truth.
 */
type BaseItem = {
  handle: string
  variantId: string | null
  designName: string
  thumbnail: string | null
}

/** This design's AirPods case, its variants keyed by AirPods model. */
export type BundleAirpods = {
  name: string
  handle: string
  variants: Record<string, { variantId: string; price: number; image: string | null }>
}

export default function PackSelector({
  config,
  unitPrice,
  baseItem,
  designs,
  caseTypes,
  bundleAirpods,
  device,
  caseType,
}: {
  config: BundleConfig | null
  unitPrice: number
  baseItem: BaseItem
  /** The pool of other designs a pack slot can be filled from. */
  designs: PackDesign[]
  /** Construction records for the picker's SELECT CASE TYPE popup. */
  caseTypes: CaseTypeRecord[]
  /** This design's AirPods case for the Matching Set bundle, or null. */
  bundleAirpods: BundleAirpods | null
  device: string
  caseType: string
}) {
  const { addMany } = useCart()
  const [activeQty, setActiveQty] = useState(1)
  const [bundleOn, setBundleOn] = useState(false)
  const [airpodsOverride, setAirpodsOverride] = useState<string | null>(null)
  const [openAirpods, setOpenAirpods] = useState(false)
  const [picked, setPicked] = useState<PickedDesign[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  // A device or case-type change re-prices the base, so any pack in progress is
  // no longer valid - reset to a single of the new selection.
  useEffect(() => {
    setActiveQty(1)
    setBundleOn(false)
    setPicked([])
  }, [device, caseType])

  const tiers = useMemo(
    () => (config?.tiers ?? []).slice().sort((a, b) => a.quantity - b.quantity),
    [config]
  )

  // The models / constructions the picker can offer: every pair that has a
  // design, with the base item's own first.
  const deviceOptions = useMemo(() => {
    const set = new Set<string>([device])
    for (const d of designs)
      for (const k of Object.keys(d.variants)) set.add(k.split("|")[0])
    return [...set]
  }, [designs, device])

  // The AirPods models for the bundle's SELECT MODEL drawer - AirPods only.
  const airpodsItems: ModelItem[] = useMemo(
    () =>
      (bundleAirpods ? Object.keys(bundleAirpods.variants) : []).map((name) => ({
        value: name,
        label: name,
        group: "AirPods",
      })),
    [bundleAirpods]
  )

  // Only constructions that a design is actually printed in - so the picker's
  // SELECT CASE TYPE popup never offers a dead option.
  const pickerCaseTypes = useMemo(() => {
    const have = new Set<string>([caseType])
    for (const d of designs)
      for (const k of Object.keys(d.variants)) have.add(k.split("|")[1])
    return caseTypes.filter((c) => have.has(c.name))
  }, [caseTypes, designs, caseType])

  if (!config || !config.settings.is_active || tiers.length === 0) return null

  // Matching Set (bundle) config, admin-set where present, else florayn defaults.
  const s = config.settings
  const ms = {
    enabled: s.matching_set_enabled ?? true,
    title: s.matching_set_title || "The Matching Set",
    subtitle: s.matching_set_subtitle || "One design, two pieces",
    discount: s.matching_set_discount ?? 250,
    defaultAirpods: s.matching_set_default_airpods || "AirPods Pro 3",
  }
  const airpodsOptions = bundleAirpods ? Object.keys(bundleAirpods.variants) : []
  const bundleAvailable = ms.enabled && airpodsOptions.length > 0
  const airpodsDevice =
    airpodsOverride && airpodsOptions.includes(airpodsOverride)
      ? airpodsOverride
      : airpodsOptions.includes(ms.defaultAirpods)
        ? ms.defaultAirpods
        : (airpodsOptions[0] ?? "")
  const airpodsVariant = bundleAirpods?.variants[airpodsDevice] ?? null
  const airpodsPrice = airpodsVariant?.price ?? 0
  const bundleSubtotal = unitPrice + airpodsPrice
  const bundleDiscount = Math.min(Math.max(0, ms.discount), bundleSubtotal)
  const bundleTotal = bundleSubtotal - bundleDiscount
  // Split the saving proportionally so each row shows its own discounted price.
  const share = (p: number) =>
    bundleSubtotal > 0 ? Math.round(p - bundleDiscount * (p / bundleSubtotal)) : p
  const phoneShare = share(unitPrice)
  const airpodsShare = share(airpodsPrice)

  const activeTier = tiers.find((t) => t.quantity === activeQty) ?? null
  const filled = 1 + picked.length
  const needed = activeTier ? Math.max(0, activeTier.quantity - filled) : 0

  // Advertised pill total assumes N of the base price; the real total (once the
  // slots are full) is the sum of the actual items, discounted by the tier.
  const filledSubtotal = unitPrice + picked.reduce((s, p) => s + p.price, 0)
  const packTotal =
    activeTier && needed === 0
      ? tierPricing(filledSubtotal / activeTier.quantity, activeTier).total
      : null

  function selectQty(qty: number, tierQ: number | null) {
    setBundleOn(false)
    setActiveQty(qty)
    if (tierQ) setPicked((cur) => cur.slice(0, tierQ - 1))
    else setPicked([])
  }

  async function addBundle() {
    if (!baseItem.variantId || !airpodsVariant || adding) return
    setAdding(true)
    try {
      await addMany(
        [
          { variantId: baseItem.variantId, quantity: 1 },
          { variantId: airpodsVariant.variantId, quantity: 1 },
        ],
        {
          productTitle: ms.title,
          variantTitle: `${baseItem.designName} phone + ${airpodsDevice}`,
          unitPrice: bundleTotal,
          thumbnail: baseItem.thumbnail,
        }
      )
      setBundleOn(false)
    } catch {
      /* the drawer rolls itself back on failure */
    }
    setAdding(false)
  }

  function onPick(design: PickedDesign) {
    setPicked((cur) =>
      activeTier && cur.length < activeTier.quantity - 1 ? [...cur, design] : cur
    )
    setModalOpen(false)
  }

  async function addPack() {
    if (!activeTier || !baseItem.variantId || needed > 0 || adding) return
    setAdding(true)
    try {
      await addMany(
        [
          { variantId: baseItem.variantId, quantity: 1 },
          ...picked.map((p) => ({ variantId: p.variantId, quantity: 1 })),
        ],
        {
          productTitle: `${activeTier.quantity}-pack`,
          variantTitle: `${baseItem.designName} + ${picked
            .map((p) => p.designName)
            .join(", ")}`,
          unitPrice: packTotal ?? unitPrice * activeTier.quantity,
          thumbnail: baseItem.thumbnail,
        }
      )
      selectQty(1, null)
    } catch {
      /* the drawer rolls itself back on failure */
    }
    setAdding(false)
  }

  const excludeHandles = [baseItem.handle, ...picked.map((p) => p.handle)]

  return (
    <section className="mt-5">
      {/* Pills: Single + each tier + Bundle. */}
      <div
        className="grid gap-[3px] rounded-[12px] bg-[#f5f3f8] p-[3px]"
        style={{
          gridTemplateColumns: `repeat(${tiers.length + 1 + (bundleAvailable ? 1 : 0)}, 1fr)`,
        }}
      >
        <PackPill
          label="Single"
          onSelect={() => selectQty(1, null)}
          active={activeQty === 1 && !bundleOn}
          now={bdt(unitPrice)}
        />
        {tiers.map((t) => {
          const p = tierPricing(unitPrice, t)
          return (
            <PackPill
              key={t.id}
              label={`${t.quantity}-pack`}
              onSelect={() => selectQty(t.quantity, t.quantity)}
              active={activeQty === t.quantity && !bundleOn}
              was={p.discount > 0 ? bdt(p.subtotal) : undefined}
              now={bdt(p.total)}
              save={p.discount > 0 ? `Save ${bdt(p.discount)}` : undefined}
            />
          )
        })}
        {bundleAvailable ? (
          <PackPill
            label="Bundle"
            onSelect={() => setBundleOn(true)}
            active={bundleOn}
            was={bundleDiscount > 0 ? bdt(bundleSubtotal) : undefined}
            now={bdt(bundleTotal)}
            save={bundleDiscount > 0 ? `Save ${bdt(bundleDiscount)}` : undefined}
          />
        ) : null}
      </div>

      {/* Bundle panel: the Matching Set (phone + AirPods). */}
      {bundleOn && bundleAvailable ? (
        <div className="mt-3.5">
          <h4 className="text-[16px] font-semibold text-[#1a1625]">{ms.title}</h4>
          <p className="mb-2.5 text-[13px] text-ink-muted">{ms.subtitle}</p>

          <div className="space-y-2">
            {/* Phone case (this item). */}
            <div className="flex items-center gap-3 rounded-[11px] border border-[#f0eef4] bg-white p-[9px]">
              <span className="relative block size-11 shrink-0 overflow-hidden rounded-[8px] bg-[#f6f5f8]">
                <ProductImage
                  src={baseItem.thumbnail}
                  alt={baseItem.designName}
                  label={baseItem.designName}
                  sizes="44px"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[#111]">
                  {baseItem.designName} — {device} Case
                </span>
                <span className="text-[12px] text-ink-muted">This item</span>
              </span>
              <span className="flex items-baseline gap-1.5 tabular-nums">
                {bundleDiscount > 0 ? (
                  <s className="text-[11px] text-ink-faint">{bdt(unitPrice)}</s>
                ) : null}
                <b className="text-[13px] font-semibold text-[#111]">{bdt(phoneShare)}</b>
              </span>
            </div>

            {/* AirPods case with a model selector. */}
            <div className="flex items-center gap-3 rounded-[11px] border border-[#f0eef4] bg-white p-[9px]">
              <span className="relative block size-11 shrink-0 overflow-hidden rounded-[8px] bg-[#f6f5f8]">
                <ProductImage
                  src={airpodsVariant?.image ?? null}
                  alt={`${baseItem.designName} AirPods`}
                  label={baseItem.designName}
                  sizes="44px"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[#111]">
                  {baseItem.designName} — AirPods Case
                </span>
                <button
                  type="button"
                  onClick={() => setOpenAirpods(true)}
                  aria-haspopup="dialog"
                  className="mt-0.5 inline-flex items-center gap-1 rounded-[6px] border border-line bg-surface px-1.5 py-[3px] text-[11px] transition-colors hover:border-line-strong"
                >
                  <span className="eyebrow">Model</span>
                  <span className="font-medium text-ink">{airpodsDevice}</span>
                  <ChevronDown className="size-3 text-ink-muted" strokeWidth={1.6} />
                </button>
              </span>
              <span className="flex items-baseline gap-1.5 tabular-nums">
                {bundleDiscount > 0 ? (
                  <s className="text-[11px] text-ink-faint">{bdt(airpodsPrice)}</s>
                ) : null}
                <b className="text-[13px] font-semibold text-[#111]">{bdt(airpodsShare)}</b>
              </span>
            </div>
          </div>

          {/* Total + saving. */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[14px] font-semibold text-[#111]">Total</span>
            <span className="flex items-baseline gap-2 tabular-nums">
              {bundleDiscount > 0 ? (
                <s className="text-[13px] text-ink-faint">{bdt(bundleSubtotal)}</s>
              ) : null}
              <b className="text-[16px] font-bold text-[#111]">{bdt(bundleTotal)}</b>
            </span>
          </div>
          {bundleDiscount > 0 ? (
            <div className="mt-2 rounded-[8px] bg-[#f3eefe] px-3 py-2 text-[13px] font-medium text-purple">
              You save {bdt(bundleDiscount)}
            </div>
          ) : null}

          <button
            type="button"
            onClick={addBundle}
            disabled={adding || !baseItem.variantId || !airpodsVariant}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#1f7a4d] py-3.5 text-[13.5px] font-bold uppercase tracking-[0.06em] text-white transition-colors hover:bg-[#1a6a42] disabled:opacity-60"
          >
            {adding ? <Spinner /> : null}
            Add bundle — {bdt(bundleTotal)}
          </button>
        </div>
      ) : null}

      {/* Panel: only for a multi pack. */}
      {activeTier && !bundleOn ? (
        <div className="mt-3.5">
          <div className="space-y-2">
            {/* Base item. */}
            <div className="flex items-center gap-3 rounded-[11px] border border-[#f0eef4] bg-white p-[9px]">
              <span className="relative block size-11 shrink-0 overflow-hidden rounded-[8px] bg-[#f6f5f8]">
                <ProductImage
                  src={baseItem.thumbnail}
                  alt={baseItem.designName}
                  label={baseItem.designName}
                  sizes="44px"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[#111]">
                  {baseItem.designName}
                </span>
                <span className="text-[12px] text-ink-muted">This item</span>
              </span>
              <span className="text-[13px] tabular-nums text-[#111]">
                {bdt(unitPrice)}
              </span>
            </div>

            {/* Picked items + one open "add" slot. */}
            {picked.map((p, i) => (
              <div
                key={`${p.handle}-${i}`}
                className="flex items-center gap-3 rounded-[11px] border border-[#f0eef4] bg-white p-[9px]"
              >
                <span className="relative block size-11 shrink-0 overflow-hidden rounded-[8px] bg-[#f6f5f8]">
                  <ProductImage src={p.image} alt={p.designName} label={p.designName} sizes="44px" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[#111]">
                    {p.designName}
                  </span>
                  <span className="text-[12px] text-ink-muted">Item {i + 2}</span>
                </span>
                <span className="text-[13px] tabular-nums text-[#111]">{bdt(p.price)}</span>
                <button
                  type="button"
                  onClick={() => setPicked((cur) => cur.filter((_, j) => j !== i))}
                  aria-label={`Remove ${p.designName}`}
                  className="grid size-6 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[#f2f0f6] hover:text-ink"
                >
                  <X className="size-4" strokeWidth={1.6} />
                </button>
              </div>
            ))}

            {/* One open "add" slot per remaining item, so a 3-pack shows both
                "Add item 2" and "Add item 3". */}
            {Array.from({ length: needed }).map((_, i) => (
              <button
                key={`slot-${filled + i}`}
                type="button"
                onClick={() => setModalOpen(true)}
                className="flex w-full items-center gap-3 rounded-[11px] border border-[#e9e6ef] bg-[#fafafa] p-[9px] text-left transition-colors hover:border-purple/40"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-[8px] border border-dashed border-line-strong text-ink-muted">
                  <Plus className="size-5" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-[#111]">
                    Add item {filled + 1 + i}
                  </span>
                  <span className="text-[12px] text-ink-muted">Pick any design</span>
                </span>
              </button>
            ))}
          </div>

          {/* Progress. */}
          <div className="mt-3 flex items-center gap-3">
            <span className="relative h-[6px] flex-1 overflow-hidden rounded-full bg-[#ece9f2]">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-ink transition-all"
                style={{ width: `${(filled / activeTier.quantity) * 100}%` }}
              />
            </span>
            <span className="text-[12px] tabular-nums text-ink-muted">
              {filled} of {activeTier.quantity}
            </span>
          </div>

          {/* CTA. */}
          <button
            type="button"
            onClick={needed > 0 ? () => setModalOpen(true) : addPack}
            disabled={adding || !baseItem.variantId}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] bg-ink py-3.5 text-[13.5px] font-bold uppercase tracking-[0.06em] text-white transition-colors hover:bg-purple disabled:opacity-60"
          >
            {adding ? <Spinner /> : null}
            {needed > 0
              ? `Select ${needed} more item${needed > 1 ? "s" : ""}`
              : `Add ${activeTier.quantity}-pack — ${bdt(packTotal ?? 0)}`}
          </button>
        </div>
      ) : null}

      <ChooseDesignModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        designs={designs}
        device={device}
        caseType={caseType}
        deviceOptions={deviceOptions}
        caseTypes={pickerCaseTypes}
        excludeHandles={excludeHandles}
        onPick={onPick}
        slotLabel={activeTier ? `${filled}/${activeTier.quantity}` : undefined}
      />

      {/* AirPods model - the shared SELECT MODEL drawer, AirPods models only. */}
      <ModelDrawer
        open={openAirpods}
        onOpenChange={setOpenAirpods}
        items={airpodsItems}
        current={airpodsDevice}
        onSelect={(name) => {
          setAirpodsOverride(name)
          setOpenAirpods(false)
        }}
        title="Select AirPods"
      />
    </section>
  )
}

function PackPill({
  label,
  onSelect,
  active,
  was,
  now,
  save,
}: {
  label: string
  onSelect: () => void
  active: boolean
  was?: string
  now: string
  save?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-[10px] border bg-white px-1 py-2 text-center transition-shadow",
        active
          ? "border-purple/40 shadow-[0_0_0_1px_rgba(124,58,237,0.35),0_3px_10px_0_rgba(124,58,237,0.14)]"
          : "border-[#ddd0fb]"
      )}
    >
      <span className="text-[10px] font-semibold text-purple">{label}</span>
      <span className="flex items-baseline gap-1">
        {was ? <s className="text-[9px] text-ink-faint">{was}</s> : null}
        <b className="text-[12.5px] font-bold text-[#1a1625]">{now}</b>
      </span>
      {save ? (
        <span className="rounded-full bg-purple px-1.5 py-[2px] text-[8.5px] font-bold text-white">
          {save}
        </span>
      ) : null}
    </button>
  )
}
