"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import DragScroll from "@/components/drag-scroll"
import type { PackDesign } from "@/components/choose-design-modal"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import PackSelector, { type MatchingProduct } from "@/components/pack-selector"
import ProductImage from "@/components/product-image"
import WishlistButton from "@/components/wishlist-button"
import { Spinner } from "@/components/ui/button"
import { useCart } from "@/components/cart-provider"
import type { BundleConfig } from "@/lib/bundles"
import type { CaseTypeRecord } from "@/lib/catalog"
import type { StoreVariant } from "@/lib/medusa"
import type { ProductVariantMatrix } from "@/lib/product-view-data"
import { formatPrice } from "@/lib/money"
import { pairKey } from "@/lib/variant-matrix"

type AddState = "idle" | "adding" | "added" | "error"

/**
 * Family group order in the device drawer, matching the shop's SELECT MODEL.
 * A device whose family the /store/devices map does not label (e.g. one that is
 * deactivated but still has blanks) is placed by inferring the family from its
 * name, so an iPhone never lands in a stray "Other" bucket.
 */
const GROUP_ORDER = [
  "iPhone",
  "Samsung Galaxy",
  "AirPods",
  "Apple Watch",
  "Card Wallet",
  "Other",
]

function groupLabel(name: string, families: Record<string, string>): string {
  const known = families[name]
  if (known) return known
  const n = name.toLowerCase()
  if (n.includes("iphone")) return "iPhone"
  if (n.includes("galaxy") || n.includes("samsung")) return "Samsung Galaxy"
  if (n.includes("airpods")) return "AirPods"
  if (n.includes("watch")) return "Apple Watch"
  if (n.includes("wallet") || n.includes("card")) return "Card Wallet"
  return "Other"
}

/**
 * The right-hand column of the product page, from the price down. Owns the two
 * linked selectors (Case Type tiles + Device drawer) and the add-to-cart form.
 * Selection state lives in the parent so the gallery can follow it; this only
 * renders the controls and reports changes back.
 */
export default function ProductBuyBox({
  matrix,
  selected,
  families,
  stock,
  productHandle,
  productTitle,
  designName,
  bundleConfig,
  packDesigns,
  caseTypeRecords,
  matchingProduct,
  thumbnail,
  caseType,
  device,
  onSelectCaseType,
  onSelectDevice,
  imageForCaseType,
  priceForCaseType,
  moreDesigns,
  shipping,
  deliveryEstimate,
  simple = false,
  optionLabel,
}: {
  matrix: ProductVariantMatrix
  /** The variant for the current (caseType, device) pair, or null. */
  selected: StoreVariant | null
  /** device name -> family label, for grouping the drawer. */
  families: Record<string, string>
  /** "<Case Type>|<Device>" -> available quantity (shared blank stock). */
  stock: Record<string, number>
  /** The product handle, the wishlist's stable key + pack base. */
  productHandle: string
  productTitle: string
  /** The design's display name, shown as the pack's base item. */
  designName: string
  /** Multi-buy tier config, or null when the widget is off / unavailable. */
  bundleConfig: BundleConfig | null
  /** Other designs a pack slot can be filled from (prepared server-side). */
  packDesigns: PackDesign[]
  /** Construction records for the pack picker's case-type popup. */
  caseTypeRecords: CaseTypeRecord[]
  /** This design's AirPods case for the Matching Set bundle, or null. */
  matchingProduct: MatchingProduct | null
  thumbnail: string | null
  caseType: string
  device: string
  onSelectCaseType: (caseType: string) => void
  onSelectDevice: (device: string) => void
  imageForCaseType: (caseType: string) => string | null
  priceForCaseType: (caseType: string) => number | null
  moreDesigns?: ReactNode
  shipping?: ReactNode
  /** Admin delivery estimate shown after "In stock"; blank hides it. */
  deliveryEstimate?: string
  /**
   * Simple mode: a non-case product (e.g. a StickPad with a Color option). The
   * device drawer and the multi-buy pack widget are hidden, and the option's
   * values are shown as the tiles under `optionLabel` (e.g. "COLOR"). The same
   * gallery, tiles, price and add-to-cart serve it, so there is one page type.
   */
  simple?: boolean
  /** The tile heading in simple mode (the option's title, e.g. "Color"). */
  optionLabel?: string
}) {
  const router = useRouter()
  const { add } = useCart()
  const [openModel, setOpenModel] = useState(false)
  const [qty, setQty] = useState(1)
  const [packMode, setPackMode] = useState(false)
  const hasOffers = !simple && !!bundleConfig?.settings.is_active && (bundleConfig.tiers.some((tier) => tier.quantity > 1) || ((bundleConfig.settings.matching_set_enabled ?? true) && Object.keys(matchingProduct?.variants ?? {}).length > 0))
  const bundleMode = hasOffers && packMode
  const [buying, setBuying] = useState(false)
  const [state, setState] = useState<AddState>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const price = selected?.calculated_price

  // The product page is cached (ISR), so its baked stock can be stale. Refresh
  // the shared blank availability client-side on mount so sold-out is current
  // and we do not oversell.
  const [liveStock, setLiveStock] = useState(stock)
  useEffect(() => {
    setLiveStock(stock)
    const base = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    const key = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    if (!base || !key) return
    const controller = new AbortController()
    const query = simple ? `?handle=${encodeURIComponent(productHandle)}` : ""
    fetch(`${base}/store/stock${query}`, { headers: { "x-publishable-api-key": key }, signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.stock) setLiveStock(d.stock)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [productHandle, simple, stock])

  // Shared blank availability. A missing key means the pair is outside the blank
  // system (e.g. a stock not tracked), so treat it as available.
  const availableFor = (ct: string, dev: string) =>
    liveStock[simple ? `variant:${matrix.variantIdByPair[pairKey(ct, dev)]}` : `${ct}|${dev}`] ?? Infinity
  const selectedOut = availableFor(caseType, device) <= 0

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  // Devices available for the selected case type only (not all 39), turned into
  // the shared model-drawer's items: family-grouped in the shop's order, with a
  // "Sold out" note when that device's blank is empty for this case type.
  const availableDevices = matrix.devicesByCaseType[caseType] ?? []
  const deviceItems: ModelItem[] = useMemo(() => {
    return availableDevices
      .map((d) => ({
        value: d,
        label: d,
        group: groupLabel(d, families),
        note: availableFor(caseType, d) <= 0 ? "Sold out" : null,
      }))
      .sort((a, b) => {
        const ga = GROUP_ORDER.indexOf(a.group)
        const gb = GROUP_ORDER.indexOf(b.group)
        return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb)
      })
  }, [availableDevices, families, caseType, liveStock])

  async function onAdd() {
    if (!selected || state === "adding") return
    setState("adding")
    try {
      await add(selected.id, qty, {
        productTitle,
        variantTitle: simple ? caseType : `${caseType} / ${device}`,
        unitPrice: price?.calculated_amount ?? 0,
        thumbnail,
      })
      setState("added")
    } catch {
      setState("error")
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setState("idle"), 2500)
  }

  // Buy it now: add the selected variant, then go straight to checkout instead
  // of opening the cart drawer.
  async function onBuyNow() {
    if (!selected || buying || selectedOut) return
    setBuying(true)
    try {
      await add(
        selected.id,
        qty,
        {
          productTitle,
          variantTitle: simple ? caseType : `${caseType} / ${device}`,
          unitPrice: price?.calculated_amount ?? 0,
          thumbnail,
        },
        { openDrawer: false }
      )
      router.push("/checkout")
    } catch {
      setBuying(false)
      setState("error")
    }
  }

  const cta = selectedOut
    ? "Sold out"
    : {
        idle: "Add to cart",
        adding: "Adding...",
        added: "Added",
        error: "Try again",
      }[state]

  return (
    <div>
      {/* Price - the selected variant's. */}
      <p className="fl-pdp-price">
        {formatPrice(price?.calculated_amount, price?.currency_code)}
      </p>

      {/* Availability from the live (refreshed) stock, so it always agrees
          with the Add to cart button. The delivery estimate is Admin copy
          (Product delivery) and never shows beside "Sold out". */}
      <p className={`fl-pdp-stock${selectedOut ? " is-out" : ""}`}>
        <span>{selectedOut ? "Sold out" : "In stock"}</span>
        {!selectedOut && deliveryEstimate ? (
          <>
            <span className="fl-pdp-stock__sep" aria-hidden="true">|</span>
            <span>{deliveryEstimate}</span>
          </>
        ) : null}
      </p>

      {/* Keep the new Bundle/pack control in the original offer position. */}
      {hasOffers ? (
      <PackSelector
        bundleMode={bundleMode}
        onModeChange={setPackMode}
        soldOut={selectedOut}
        config={bundleConfig}
        unitPrice={price?.calculated_amount ?? 0}
        baseItem={{
          handle: productHandle,
          variantId: selected?.id ?? null,
          designName,
          thumbnail,
        }}
        designs={packDesigns}
        caseTypes={caseTypeRecords}
        matchingProduct={matchingProduct}
        device={device}
        caseType={caseType}
      />
      ) : null}

      {/* DEVICE - opens the same florayn SELECT MODEL drawer as the shop, but
          picks the device in place (no navigation). Order matches florayn:
          Device, then More designs, then Case type. Hidden for a simple
          accessory (StickPad), which has no device. */}
      {!simple ? (
      <div className="mt-3.5 md:mt-5">
        <div className="min-w-0">
        <p className="fl-pdp-label">MODEL</p>
        <button
          type="button"
          onClick={() => setOpenModel(true)}
          aria-haspopup="dialog"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px] border border-[#e2e2e2] bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-line-strong focus:border-purple focus:outline-none"
        >
          <span className="truncate">{device || "Select a device"}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M3 5l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        </div>
        <ModelDrawer
          open={openModel}
          onOpenChange={setOpenModel}
          items={deviceItems}
          current={device}
          onSelect={(d) => {
            onSelectDevice(d)
            setOpenModel(false)
            setState("idle")
          }}
        />
      </div>
      ) : null}

      {moreDesigns}

      {/* Option selector. A simple product (StickPad) shows a compact,
          horizontally scrollable slider of small swatches - no big thumbnails -
          with the current value beside the label. */}
      {simple ? (
        matrix.caseTypes.length > 1 ? (
          <section className="mt-4 md:mt-6">
            <p className="fl-pdp-label">
              {(optionLabel ?? "Options").toUpperCase()}
              <span className="ml-2 font-normal normal-case tracking-normal text-ink-muted">
                {caseType}
              </span>
            </p>
            <ul className="mt-2 flex gap-[10px] overflow-x-auto pb-1">
              {matrix.caseTypes.map((ct) => {
                const isCurrent = ct === caseType
                return (
                  <li key={ct} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectCaseType(ct)}
                      aria-pressed={isCurrent}
                      aria-label={ct}
                      title={ct}
                      className={[
                        "block size-[54px] overflow-hidden rounded-[12px] border-2 bg-surface transition-colors",
                        isCurrent ? "border-purple" : "border-[#e2e2e2] hover:border-purple",
                      ].join(" ")}
                    >
                      <span className="relative block size-full">
                        <ProductImage src={imageForCaseType(ct)} alt={ct} label={ct} sizes="54px" />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null
      ) : /* CASE TYPE tiles (image + name + price) for a real case product. A
             case type not sold for the selected device is disabled, not hidden. */
      matrix.caseTypes.length > 1 ? (
        <section className="mt-3.5 md:mt-5">
          <p className="fl-pdp-label">CASE TYPE</p>
          <DragScroll className="fl-case-tiles">
            {matrix.caseTypes.map((ct) => {
              const fits = (matrix.caseTypesByDevice[device] ?? []).includes(ct)
              const isCurrent = ct === caseType
              const soldOut = fits && availableFor(ct, device) <= 0
              const img = imageForCaseType(ct)
              const ctPrice = priceForCaseType(ct)
              return (
                <li key={ct} className="fl-case-tiles__item">
                  <button
                    type="button"
                    onClick={() => onSelectCaseType(ct)}
                    aria-pressed={isCurrent}
                    disabled={!fits && !isCurrent}
                    title={!fits ? `${ct} is not made for ${device}` : ct}
                    className={[
                      "flex h-full w-full flex-col overflow-hidden rounded-[10px] border bg-surface text-left transition-colors",
                      isCurrent
                        ? "border-purple"
                        : "border-[#e2e2e2] hover:border-purple",
                      (!fits && !isCurrent) || soldOut ? "opacity-40" : "",
                    ].join(" ")}
                  >
                    <span className="relative block aspect-[9/10] w-full overflow-hidden rounded-t-[9px]">
                      <ProductImage
                        src={img}
                        alt={ct}
                        label={ct}
                        sizes="(max-width: 768px) 25vw, 135px"
                      />
                    </span>
                    <span className="flex w-full flex-1 flex-col justify-between px-1 py-2 text-center">
                      <span className="block text-[11px] font-semibold leading-tight md:text-[13px]">
                        {ct}
                      </span>
                      <span className="mt-0.5 block text-[11px] tabular-nums text-ink-muted md:text-[13px]">
                        {soldOut
                          ? "Sold out"
                          : ctPrice != null
                            ? formatPrice(ctPrice)
                            : null}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </DragScroll>
        </section>
      ) : null}

      {/* Quantity + add to cart + wishlist heart (one row, florayn layout). */}
      {!bundleMode ? <>
      <div className="mt-4 flex items-stretch gap-[10px] md:mt-5">
        <div className="flex h-[50px] items-center rounded-[30px] border border-line">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
            className="grid size-[38px] place-items-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            &minus;
          </button>
          <span aria-live="polite" className="w-6 text-center text-sm tabular-nums">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(99, q + 1))}
            disabled={qty >= 99}
            aria-label="Increase quantity"
            className="grid size-[38px] place-items-center rounded-full text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={!selected || selectedOut || state === "adding"}
          className={[
            "flex h-[50px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[30px] px-4 text-[15px] font-semibold transition-colors",
            state === "error"
              ? "border border-danger text-danger"
              : "bg-ink text-white hover:bg-purple",
            "disabled:opacity-60",
          ].join(" ")}
        >
          {state === "adding" ? <Spinner /> : null}
          {cta}
          {state === "added" ? (
            <span aria-hidden="true" className="text-base leading-none">
              &#10003;
            </span>
          ) : null}
        </button>

        <WishlistButton
          handle={productHandle}
          title={productTitle}
          thumbnail={thumbnail}
        />
      </div>

      {/* Buy it now - full-width purple, straight to checkout. */}
      <button
        type="button"
        onClick={onBuyNow}
        disabled={!selected || selectedOut || buying}
        className="mt-2 flex h-[50px] w-full md:mt-[10px] items-center justify-center gap-2 rounded-[30px] bg-purple px-6 text-[15px] font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
      >
        {buying ? <Spinner /> : null}
        {buying ? "Taking you to checkout..." : "Buy it now"}
      </button>

      </> : null}

      <p role="status" aria-live="polite" className="sr-only">
        {state === "adding"
          ? "Adding to cart"
          : state === "added"
            ? `${caseType} ${device} added to cart`
            : state === "error"
              ? "Could not add to cart. Try again."
              : ""}
      </p>

      {state === "error" ? (
        <p className="mt-3 text-sm text-danger">
          Could not add that to your cart. Check your connection and try again.
        </p>
      ) : null}

      {shipping}
    </div>
  )
}
