"use client"

import { Check, ChevronDown, Plus, Tag, X } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"

import ChooseDesignModal, {
  type PackDesign,
  type PickedDesign,
} from "@/components/choose-design-modal"
import ModelDrawer from "@/components/model-drawer"
import ProductImage from "@/components/product-image"
import { Spinner } from "@/components/ui/button"
import { useCart } from "@/components/cart-provider"
import { tierPricing, type BundleConfig } from "@/lib/bundles"
import type { CaseTypeRecord } from "@/lib/catalog"
import { formatPrice } from "@/lib/money"

type BaseItem = {
  handle: string
  variantId: string | null
  designName: string
  thumbnail: string | null
}
export type MatchingProduct = {
  form?: string
  defaultDevice?: string
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
  matchingProduct,
  device,
  caseType,
  bundleMode,
  onModeChange,
  soldOut,
}: {
  config: BundleConfig | null
  unitPrice: number
  baseItem: BaseItem
  designs: PackDesign[]
  caseTypes: CaseTypeRecord[]
  matchingProduct: MatchingProduct | null
  device: string
  caseType: string
  bundleMode: boolean
  onModeChange: (bundle: boolean) => void
  soldOut: boolean
}) {
  const { addMany } = useCart()
  const groupId = useId()
  const [offer, setOffer] = useState("")
  const [picked, setPicked] = useState<PickedDesign[]>([])
  const [matchingOverride, setMatchingOverride] = useState("")
  const [openMatching, setOpenMatching] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")
  const addLock = useRef(false)

  // A new base combination must never inherit a pack made for another device.
  useEffect(() => {
    setPicked([])
    setError("")
    setModalOpen(false)
    onModeChange(false)
  }, [device, caseType, baseItem.variantId, onModeChange])

  const tiers = useMemo(
    () =>
      (config?.tiers ?? [])
        .filter((t) => t.quantity > 1)
        .slice()
        .sort((a, b) => a.quantity - b.quantity),
    [config],
  )
  const deviceOptions = useMemo(
    () => [
      ...new Set([
        device,
        ...designs.flatMap((d) => Object.keys(d.variants).map((k) => k.split("|")[0])),
      ]),
    ],
    [designs, device],
  )
  const pickerCaseTypes = useMemo(() => {
    const have = new Set([
      caseType,
      ...designs.flatMap((d) => Object.keys(d.variants).map((k) => k.split("|")[1])),
    ])
    return caseTypes.filter((c) => have.has(c.name))
  }, [caseTypes, designs, caseType])
  const s = config?.settings
  const matchingOptions = Object.keys(matchingProduct?.variants ?? {})
  const matchingAvailable = (s?.matching_set_enabled ?? true) && matchingOptions.length > 0
  const defaultMatchingDevice = matchingProduct?.defaultDevice ?? s?.matching_set_default_airpods ?? "AirPods Pro 3"
  const matchingDevice = matchingOptions.includes(matchingOverride)
    ? matchingOverride
    : matchingOptions.includes(defaultMatchingDevice)
      ? defaultMatchingDevice
      : (matchingOptions[0] ?? "")
  const matchingVariant = matchingProduct?.variants[matchingDevice]
  const matchingTitle = s?.matching_set_title || "The Matching Set"
  const matchingSubtotal = unitPrice + (matchingVariant?.price ?? 0)
  const matchingDiscount = Math.min(Math.max(0, s?.matching_set_discount ?? 250), matchingSubtotal)
  const matchingQuote = {
    subtotal: matchingSubtotal,
    discount: matchingDiscount,
    total: matchingSubtotal - matchingDiscount,
  }
  const activeOffer =
    offer === "matching" && matchingAvailable
      ? "matching"
      : tiers.some((t) => t.id === offer)
        ? offer
        : (tiers[0]?.id ?? "matching")
  const matchingOn = activeOffer === "matching"
  const tier = tiers.find((t) => t.id === activeOffer)
  const needed = tier ? Math.max(0, tier.quantity - 1 - picked.length) : 0
  // Unfilled slots use the selected case's price and are explicitly estimates.
  // Once filled, mixed models/constructions use their actual variant prices.
  const subtotal = unitPrice + picked.reduce((sum, p) => sum + p.price, 0) + needed * unitPrice
  const quote = matchingOn
    ? matchingQuote
    : tier
      ? tierPricing(subtotal / tier.quantity, tier)
      : null

  if (!s?.is_active || (!tiers.length && !matchingAvailable)) return null

  function selectOffer(id: string) {
    setOffer(id)
    setError("")
    const nextTier = tiers.find((t) => t.id === id)
    setPicked((all) => (nextTier ? all.slice(0, nextTier.quantity - 1) : []))
  }

  async function addSelection() {
    if (addLock.current || !baseItem.variantId || soldOut || !quote) return
    if (!matchingOn && needed > 0) {
      setModalOpen(true)
      return
    }
    if (matchingOn && !matchingVariant) return
    addLock.current = true
    setAdding(true)
    setError("")
    try {
      const extra = matchingOn
        ? [{ variantId: matchingVariant!.variantId, quantity: 1 }]
        : picked.map((p) => ({ variantId: p.variantId, quantity: 1 }))
      await addMany([{ variantId: baseItem.variantId, quantity: 1 }, ...extra], {
        productTitle: matchingOn ? matchingTitle : `${tier!.quantity}-pack`,
        variantTitle: matchingOn
          ? `${baseItem.designName}: ${device} + ${matchingDevice}`
          : [baseItem.designName, ...picked.map((p) => p.designName)].join(" + "),
        unitPrice: quote.total,
        thumbnail: baseItem.thumbnail,
      })
      setPicked([])
      onModeChange(false)
    } catch {
      setError("Could not add your selection. Please check your connection and try again.")
    } finally {
      addLock.current = false
      setAdding(false)
    }
  }

  const baseRow = (
    <ItemRow
      image={baseItem.thumbnail}
      title={baseItem.designName}
      detail={`${caseType} / ${device}`}
      price={unitPrice}
      badge="This item"
    />
  )

  return (
    <section id="bundle-pack" className="fl-offers scroll-mt-40" aria-label="Bundle/pack">
      <div className="fl-offers__switch" role="group" aria-label="Purchase option">
        <button
          type="button"
          aria-pressed={!bundleMode}
          disabled={adding}
          onClick={() => onModeChange(false)}
        >
          Product only
        </button>
        <button
          type="button"
          aria-pressed={bundleMode}
          disabled={adding}
          onClick={() => onModeChange(true)}
        >
          Bundle/pack <Tag size={14} aria-hidden="true" />
        </button>
      </div>
      {bundleMode ? (
        <div className="fl-offers__body">
          <div className="mb-4">
            <h2 className="text-base font-semibold">{s.heading || "Choose your bundle or pack"}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Make it yours. Choose your items and see your savings.
            </p>
          </div>
          <fieldset className="grid min-w-0 gap-3" disabled={adding}>
            <legend className="sr-only">Choose a bundle or pack</legend>
            {tiers.map((t) => {
              const active = activeOffer === t.id
              const preview = active && quote ? quote : tierPricing(unitPrice, t)
              return (
                <OfferCard
                  key={t.id}
                  name={groupId}
                  value={t.id}
                  active={active}
                  onSelect={() => selectOffer(t.id)}
                  title={`${t.quantity}-pack`}
                  description={`Your selected case + ${t.quantity - 1} design${t.quantity > 2 ? "s" : ""} of your choice.`}
                  badge={t.badge}
                  quote={preview}
                  estimated={!active || needed > 0}
                >
                  {active ? (
                    <div className="fl-offer__items">
                      {baseRow}
                      {picked.map((p, i) => (
                        <ItemRow
                          key={`${p.variantId}-${i}`}
                          image={p.image}
                          title={p.designName}
                          detail={`${p.caseType} / ${p.device}`}
                          price={p.price}
                          action={
                            <button
                              type="button"
                              onClick={() => setPicked((all) => all.filter((_, j) => j !== i))}
                              aria-label={`Remove ${p.designName}`}
                              className="fl-offer__remove"
                            >
                              <X size={16} />
                            </button>
                          }
                        />
                      ))}
                      {Array.from({ length: needed }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          className="fl-offer__add"
                          onClick={() => setModalOpen(true)}
                        >
                          <span>
                            <Plus size={20} />
                          </span>
                          <span>
                            <strong>Choose item {picked.length + i + 2}</strong>
                            <small>Explore designs, models & case types</small>
                          </span>
                          <Plus size={16} aria-hidden="true" />
                        </button>
                      ))}
                      <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
                        <Check size={14} aria-hidden="true" />
                        {1 + picked.length} of {t.quantity} items selected
                      </p>
                    </div>
                  ) : (
                    <div className="fl-offer__preview" aria-hidden="true">
                      <MiniImage src={baseItem.thumbnail} />
                      {Array.from({ length: Math.min(t.quantity - 1, 3) }, (_, i) => (
                        <span key={i} className="contents">
                          <Plus size={14} />
                          <span className="fl-offer__empty">{i + 2}</span>
                        </span>
                      ))}
                      {t.quantity > 4 ? <span>+{t.quantity - 4}</span> : null}
                    </div>
                  )}
                </OfferCard>
              )
            })}
            {matchingAvailable ? (
              <OfferCard
                name={groupId}
                value="matching"
                active={matchingOn}
                onSelect={() => selectOffer("matching")}
                title={matchingTitle}
                description={s.matching_set_subtitle || "One design, two pieces"}
                quote={matchingQuote}
              >
                {matchingOn ? (
                  <div className="fl-offer__items">
                    {baseRow}
                    <ItemRow
                      image={matchingVariant?.image ?? null}
                      title={`${matchingProduct?.name ?? baseItem.designName} ${matchingProduct?.form === "phone" ? "phone case" : "AirPods case"}`}
                      detail={
                        <button
                          type="button"
                          onClick={() => setOpenMatching(true)}
                          aria-haspopup="dialog"
                          className="fl-offer__model"
                        >
                          {matchingDevice}
                          <ChevronDown size={13} />
                        </button>
                      }
                      price={matchingVariant?.price ?? 0}
                    />
                  </div>
                ) : (
                  <div className="fl-offer__preview" aria-hidden="true">
                    <MiniImage src={baseItem.thumbnail} />
                    <Plus size={14} />
                    <MiniImage src={matchingVariant?.image ?? null} />
                  </div>
                )}
              </OfferCard>
            ) : null}
          </fieldset>
          {quote ? (
            <div aria-live="polite">
              {quote.discount > 0 ? (
                <p className="fl-offers__saving">
                  <Tag size={16} aria-hidden="true" />
                  {!matchingOn && needed > 0 ? "Estimated saving" : "You save"}{" "}
                  {formatPrice(quote.discount)}
                </p>
              ) : null}
              <dl className="fl-offers__totals">
                <div>
                  <dt>Items subtotal</dt>
                  <dd>{formatPrice(quote.subtotal)}</dd>
                </div>
                {quote.discount > 0 ? (
                  <div>
                    <dt>Bundle/pack savings</dt>
                    <dd>−{formatPrice(quote.discount)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{!matchingOn && needed > 0 ? "Estimated total" : "Total"}</dt>
                  <dd>{formatPrice(quote.total)}</dd>
                </div>
              </dl>
              {!matchingOn && needed > 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  Estimate uses your selected case price. Your total updates as you choose each
                  item.
                </p>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            onClick={addSelection}
            disabled={adding || !baseItem.variantId || soldOut || !quote}
            className="fl-offers__cta"
          >
            {adding ? <Spinner /> : null}
            {soldOut
              ? "Selected case is sold out"
              : adding
                ? "Adding to your bag…"
                : !matchingOn && needed > 0
                  ? `Choose ${needed} more item${needed > 1 ? "s" : ""}`
                  : `Add ${matchingOn ? "bundle" : `${tier?.quantity}-pack`} · ${formatPrice(quote?.total ?? 0)}`}
          </button>
          <p className="mt-2 text-center text-xs text-ink-muted">Delivery calculated at checkout</p>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
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
        excludeHandles={[baseItem.handle, ...picked.map((p) => p.handle)]}
        onPick={(design) => {
          setPicked((all) => (tier && all.length < tier.quantity - 1 ? [...all, design] : all))
          setModalOpen(false)
          setError("")
        }}
        slotLabel={tier ? `${1 + picked.length}/${tier.quantity}` : undefined}
      />
      <ModelDrawer
        open={openMatching}
        onOpenChange={setOpenMatching}
        items={matchingOptions.map((name) => ({ value: name, label: name, group: matchingProduct?.form === "phone" ? "Phone models" : "AirPods" }))}
        current={matchingDevice}
        onSelect={(name) => {
          setMatchingOverride(name)
          setOpenMatching(false)
        }}
        title={matchingProduct?.form === "phone" ? "Select phone model" : "Select AirPods"}
      />
    </section>
  )
}

function MiniImage({ src }: { src: string | null }) {
  return (
    <span className="fl-offer__thumb">
      <ProductImage src={src} alt="" sizes="56px" />
    </span>
  )
}

function OfferCard({
  name,
  value,
  active,
  onSelect,
  title,
  description,
  badge,
  quote,
  estimated,
  children,
}: {
  name: string
  value: string
  active: boolean
  onSelect: () => void
  title: string
  description: string
  badge?: string | null
  quote: { subtotal: number; discount: number; total: number }
  estimated?: boolean
  children: ReactNode
}) {
  return (
    <div className={`fl-offer${active ? " is-selected" : ""}`}>
      {badge ? <p className="fl-offer__badge">{badge}</p> : null}
      <label className="fl-offer__choice">
        <input type="radio" name={name} value={value} checked={active} onChange={onSelect} />
        <span className="min-w-0">
          <strong>{title}</strong>
          <span className="fl-offer__description">{description}</span>
        </span>
        <span className="fl-offer__price">
          {estimated ? <small>Estimated</small> : null}
          {quote.discount > 0 ? <s>{formatPrice(quote.subtotal)}</s> : null}
          <b>{formatPrice(quote.total)}</b>
        </span>
      </label>
      {children}
    </div>
  )
}

function ItemRow({
  image,
  title,
  detail,
  price,
  badge,
  action,
}: {
  image: string | null
  title: string
  detail: ReactNode
  price: number
  badge?: string
  action?: ReactNode
}) {
  return (
    <div className="fl-offer__item">
      <MiniImage src={image} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">
          {title} {badge ? <span className="fl-offer__item-badge">{badge}</span> : null}
        </p>
        <div className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</div>
        <p className="mt-1 text-sm tabular-nums">{formatPrice(price)}</p>
      </div>
      {action}
    </div>
  )
}
