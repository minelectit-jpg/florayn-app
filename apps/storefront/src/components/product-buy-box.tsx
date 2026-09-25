"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"

import DragScroll from "@/components/drag-scroll"
import type { PackDesign } from "@/components/choose-design-modal"
import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import PackSelector, { type MatchingProduct } from "@/components/pack-selector"
import ProductBuyBar, { useScrolledPast } from "@/components/product-buy-bar"
import ProductImage from "@/components/product-image"
import WishlistButton from "@/components/wishlist-button"
import { Spinner } from "@/components/ui/button"
import { useCart } from "@/components/cart-provider"
import type { BundleConfig } from "@/lib/bundles"
import { buyNowQuantity, maxQuantity, soldOutAlternatives } from "@/lib/buy-box"
import type { CaseTypeRecord } from "@/lib/catalog"
import type { StoreVariant } from "@/lib/medusa"
import type { ProductVariantMatrix } from "@/lib/product-view-data"
import { formatPrice } from "@/lib/money"
import type { BuyBoxPresentation } from "@/lib/storefront-presentation"
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
  buyBox,
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
  /** Admin > Buy buttons: labels, style, the quick-buy bar and the sold-out slot. */
  buyBox: BuyBoxPresentation
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
  const { add, items: bagItems } = useCart()
  const [openModel, setOpenModel] = useState(false)
  const [qty, setQty] = useState(1)
  const [packMode, setPackMode] = useState(false)
  const hasOffers = !simple && !!bundleConfig?.settings.is_active && (bundleConfig.tiers.some((tier) => tier.quantity > 1) || ((bundleConfig.settings.matching_set_enabled ?? true) && Object.keys(matchingProduct?.variants ?? {}).length > 0))
  const bundleMode = hasOffers && packMode
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState(false)
  const [state, setState] = useState<AddState>("idle")
  /** What the last add was for, so "Added" and its announcement never follow another selection. */
  const [addedFor, setAddedFor] = useState<{ id: string; label: string } | null>(null)
  /** Variants added on this page, so Buy it now does not add the same case twice. */
  const addedHere = useRef(new Set<string>())
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ctaRef = useRef<HTMLDivElement>(null)
  const stockLineId = useId()
  // One action at a time: Add to cart, Buy it now and the bar share this guard.
  const busy = state === "adding" || buying

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
  // The quantity never passes live stock. Server and first client render use
  // the same baked stock, so the markup matches; the refresh then clamps.
  const maxQty = maxQuantity(availableFor(caseType, device))
  useEffect(() => { setQty((q) => Math.min(q, maxQty)) }, [maxQty])

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  // A new selection clears "Added" / "Try again" (never a running add) and a
  // failed Buy it now.
  const selectedId = selected?.id ?? null
  useEffect(() => {
    setState((s) => (s === "added" || s === "error" ? "idle" : s))
    setBuyError(false)
  }, [selectedId])
  useEffect(() => { setBuyError(false) }, [qty])
  const showAdded = state === "added" && addedFor?.id === selectedId

  // A Back from checkout can restore this page from the browser's cache with
  // "Taking you to checkout" still spinning; start fresh instead.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) { setBuying(false); setBuyError(false) } }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [])

  // Picking a case type from the sold-out slot, or a model from "Choose another
  // model", removes the button that had focus; hand focus to the buy button that
  // takes its place so keyboard and screen-reader users are not dropped.
  const primaryRef = useRef<HTMLButtonElement>(null)
  const focusPrimary = useRef(false)
  const modelFromSlot = useRef(false)
  useEffect(() => {
    if (!focusPrimary.current) return
    focusPrimary.current = false
    // After the model drawer has finished returning focus.
    const timer = setTimeout(() => primaryRef.current?.focus(), 250)
    return () => clearTimeout(timer)
  }, [selectedId])

  // Checkout is dynamic, so it is prefetched on intent only (hover, press,
  // focus of a Buy it now button), once per page.
  const prefetched = useRef(false)
  const prefetchCheckout = useCallback(() => {
    if (prefetched.current) return
    prefetched.current = true
    router.prefetch("/checkout/")
  }, [router])

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

  const optimistic = () => ({
    productTitle,
    variantTitle: simple ? caseType : `${caseType} / ${device}`,
    unitPrice: price?.calculated_amount ?? 0,
    thumbnail,
  })
  const selectionLabel = simple ? caseType : `${caseType} ${device}`

  async function onAdd() {
    if (!selected || selectedOut || busy) return
    const id = selected.id
    setAddedFor({ id, label: selectionLabel })
    setBuyError(false)
    setState("adding")
    try {
      await add(id, qty, optimistic())
      addedHere.current.add(id)
      setState("added")
    } catch {
      setState("error")
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setState((s) => (s === "adding" ? s : "idle")), 2500)
  }

  // Buy it now: add the selected case, then go straight to checkout instead of
  // opening the cart drawer. A case already added on this page is not added a
  // second time (Add to cart, then Buy it now, means "buy it").
  async function onBuyNow() {
    if (!selected || selectedOut || busy) return
    const id = selected.id
    setBuyError(false)
    setBuying(true)
    const inBag = bagItems ? (bagItems.find((item) => item.variant?.id === id)?.quantity ?? 0) : null
    const need = buyNowQuantity(qty, addedHere.current.has(id), inBag)
    try {
      if (need > 0) {
        await add(id, need, optimistic(), { openDrawer: false })
        addedHere.current.add(id)
      }
      router.push("/checkout/")
    } catch {
      setBuying(false)
      setBuyError(true)
    }
  }

  const addLabel = state === "adding"
    ? "Adding…"
    : showAdded
      ? "Added"
      : state === "error"
        ? "Try again"
        : buyBox.add_to_cart_label
  const unitPrice = price?.calculated_amount
  const totalPrice = unitPrice != null ? formatPrice(unitPrice * qty, price?.currency_code) : null

  // Sold out: the in-stock case types for this model, one tap each.
  const alternatives = selectedOut && buyBox.sold_out_suggestions
    ? soldOutAlternatives({
        caseTypes: matrix.caseTypes,
        current: caseType,
        fits: simple ? () => true : (ct) => (matrix.caseTypesByDevice[device] ?? []).includes(ct),
        available: (ct) => availableFor(ct, device),
      })
    : []

  // The quick-buy bar: after the buttons scroll away, on phones and tablets.
  const barOn = buyBox.sticky_bar
  const past = useScrolledPast(ctaRef, barOn && !bundleMode)
  const barAction = buyBox.sticky_bar_action
  const statusText = state === "adding"
    ? "Adding to cart"
    : buying
      ? "Taking you to checkout"
      : showAdded && addedFor
        ? `${addedFor.label} added to cart`
        : state === "error"
          ? "Could not add to cart. Try again."
          : buyError
            ? "Could not start checkout. Try again."
            : selectedOut && selected
              ? simple ? `${caseType} is sold out` : `${caseType} is sold out for ${device}`
              : ""

  return (
    <div>
      {/* Price - the selected variant's. */}
      <p className="fl-pdp-price">
        {formatPrice(price?.calculated_amount, price?.currency_code)}
      </p>

      {/* Availability from the live (refreshed) stock, so it always agrees
          with the Add to cart button. The delivery estimate is Admin copy
          (Product delivery) and never shows beside "Sold out". */}
      <p id={stockLineId} className={`fl-pdp-stock${selectedOut ? " is-out" : ""}`}>
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
          onClick={() => { modelFromSlot.current = false; setOpenModel(true) }}
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
            // "Added"/"Try again" clear on the new selection (the selectedId
            // effect); a running add keeps its busy guard.
            if (modelFromSlot.current) focusPrimary.current = true
            modelFromSlot.current = false
            onSelectDevice(d)
            setOpenModel(false)
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
          <section className="mt-3.5 md:mt-6">
            <p className="fl-pdp-label">
              {(optionLabel ?? "Options").toUpperCase()}
              <span className="ml-2 font-normal normal-case tracking-normal text-ink-muted">
                {caseType}
              </span>
            </p>
            <DragScroll className="fl-swatches mt-2 flex gap-[10px] overflow-x-auto" indicator>
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
            </DragScroll>
          </section>
        ) : null
      ) : /* CASE TYPE tiles (image + name + price) for a real case product. A
             case type not sold for the selected device is disabled, not hidden. */
      matrix.caseTypes.length > 1 ? (
        <section className="mt-3.5 md:mt-5">
          <p className="fl-pdp-label">CASE TYPE</p>
          <DragScroll className="fl-case-tiles" indicator>
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

      {/* Quantity + Add to cart + wishlist heart in one row, then the one
          filled (purple) button: Buy it now with the price on it. The bar
          below watches this wrapper. */}
      {!bundleMode ? <>
      <div ref={ctaRef} data-buy-cta className="mt-3.5 md:mt-5">
      <div className="flex items-stretch gap-[10px] max-[359px]:gap-2">
        <div role="group" aria-label="Quantity" className="flex h-[50px] items-center rounded-[30px] border border-line">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
            className="grid size-11 place-items-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline-offset-[-2px] disabled:opacity-40"
          >
            &minus;
          </button>
          <span aria-live="polite" aria-atomic="true" className="w-7 text-center text-sm tabular-nums max-[359px]:w-6">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            disabled={qty >= maxQty}
            aria-label="Increase quantity"
            className="grid size-11 place-items-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline-offset-[-2px] disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={() => { if (!buying) void onAdd() }}
          disabled={!selected || selectedOut}
          aria-disabled={buying || undefined}
          aria-busy={state === "adding" || undefined}
          aria-describedby={selectedOut ? stockLineId : undefined}
          data-state={showAdded ? "added" : state === "error" ? "error" : undefined}
          className={`fl-buy-cta flex-1 ${buyBox.add_to_cart_style === "filled" ? "fl-buy-cta--ink" : "fl-buy-cta--outline"}`}
        >
          {state === "adding" ? <Spinner /> : null}
          <span className="fl-buy-cta__label">{selectedOut ? "Sold out" : addLabel}</span>
          {showAdded ? (
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

      {/* The primary slot: Buy it now, or, when the case is sold out, the case
          types that are in stock for this model (same height, nothing moves). */}
      {selectedOut && selected && buyBox.sold_out_suggestions ? (
        alternatives.length ? (
          <div className="fl-soldout-alt" role="group" aria-label={buyBox.sold_out_label || "Available case types"}>
            {buyBox.sold_out_label ? <span className="fl-soldout-alt__label">{buyBox.sold_out_label}</span> : null}
            {alternatives.map((ct) => {
              const altPrice = priceForCaseType(ct)
              return (
                <button key={ct} type="button" onClick={() => { focusPrimary.current = true; onSelectCaseType(ct) }}>
                  {ct}{altPrice != null ? ` · ${formatPrice(altPrice)}` : ""}
                </button>
              )
            })}
          </div>
        ) : !simple ? (
          <div className="fl-soldout-alt">
            <button type="button" onClick={() => { modelFromSlot.current = true; setOpenModel(true) }}>{buyBox.sold_out_other_model_label}</button>
          </div>
        ) : (
          <button type="button" disabled className="fl-buy-cta fl-buy-cta--primary mt-2 w-full md:mt-[10px]">Sold out</button>
        )
      ) : (
        <button
          ref={primaryRef}
          type="button"
          onClick={() => { if (state !== "adding") void onBuyNow() }}
          onPointerEnter={prefetchCheckout}
          onPointerDown={prefetchCheckout}
          onFocus={prefetchCheckout}
          disabled={!selected || selectedOut}
          aria-disabled={state === "adding" || buying || undefined}
          aria-busy={buying || undefined}
          className="fl-buy-cta fl-buy-cta--primary mt-2 w-full md:mt-[10px]"
        >
          {buying ? (
            <><Spinner />Taking you to checkout…</>
          ) : selectedOut ? (
            "Sold out"
          ) : (
            <>
              <span className="fl-buy-cta__label">{buyBox.buy_now_label}</span>
              {buyBox.show_price_in_buy_now && selected && totalPrice ? (
                <>
                  <span className="fl-buy-cta__sep" aria-hidden="true">·</span>
                  <span className="fl-buy-cta__price">{totalPrice}</span>
                </>
              ) : null}
            </>
          )}
        </button>
      )}
      </div>

      {state === "error" ? (
        <p className="mt-2 text-sm text-danger">
          Could not add that to your cart. Please try again.
        </p>
      ) : null}
      {buyError ? (
        <p className="mt-2 text-sm text-danger">
          Could not start checkout. Please try again.
        </p>
      ) : null}

      </> : null}

      <p role="status" aria-live="polite" className="sr-only">
        {statusText}
      </p>

      {barOn ? (
        <ProductBuyBar
          visible={past && !bundleMode && !!selected}
          price={totalPrice ?? ""}
          detail={simple ? caseType : `${device} · ${caseType}`}
          onDetail={simple ? null : () => { modelFromSlot.current = false; setOpenModel(true) }}
          armed={!bundleMode && !!selected}
          action={barAction}
          label={barAction === "buy_now" ? buyBox.buy_now_label : buyBox.add_to_cart_label}
          soldOut={selectedOut}
          busy={busy}
          pending={barAction === "buy_now" ? buying : state === "adding"}
          added={barAction === "add_to_cart" && showAdded}
          onAction={barAction === "buy_now" ? () => void onBuyNow() : () => void onAdd()}
          onIntent={barAction === "buy_now" ? prefetchCheckout : undefined}
        />
      ) : null}
    </div>
  )
}
