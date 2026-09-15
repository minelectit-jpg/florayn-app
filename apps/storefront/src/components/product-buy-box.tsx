"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import ModelDrawer, { type ModelItem } from "@/components/model-drawer"
import ProductImage from "@/components/product-image"
import ShareButton from "@/components/share-button"
import WishlistButton from "@/components/wishlist-button"
import { Spinner } from "@/components/ui/button"
import { useCart } from "@/components/cart-provider"
import type { StoreVariant } from "@/lib/medusa"
import { formatPrice } from "@/lib/money"
import { pairKey, type VariantMatrix } from "@/lib/variant-matrix"

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
  thumbnail,
  caseType,
  device,
  onSelectCaseType,
  onSelectDevice,
  imageForCaseType,
  priceForCaseType,
  moreDesigns,
  shipping,
}: {
  matrix: VariantMatrix
  /** The variant for the current (caseType, device) pair, or null. */
  selected: StoreVariant | null
  /** device name -> family label, for grouping the drawer. */
  families: Record<string, string>
  /** "<Case Type>|<Device>" -> available quantity (shared blank stock). */
  stock: Record<string, number>
  /** The product handle, the wishlist's stable key. */
  productHandle: string
  productTitle: string
  thumbnail: string | null
  caseType: string
  device: string
  onSelectCaseType: (caseType: string) => void
  onSelectDevice: (device: string) => void
  imageForCaseType: (caseType: string) => string | null
  priceForCaseType: (caseType: string) => number | null
  moreDesigns?: ReactNode
  shipping?: ReactNode
}) {
  const router = useRouter()
  const { add } = useCart()
  const [openModel, setOpenModel] = useState(false)
  const [qty, setQty] = useState(1)
  const [buying, setBuying] = useState(false)
  const [state, setState] = useState<AddState>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const price = selected?.calculated_price

  // The product page is cached (ISR), so its baked stock can be stale. Refresh
  // the shared blank availability client-side on mount so sold-out is current
  // and we do not oversell.
  const [liveStock, setLiveStock] = useState(stock)
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    const key = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
    if (!base || !key) return
    fetch(`${base}/store/stock`, { headers: { "x-publishable-api-key": key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.stock) setLiveStock(d.stock)
      })
      .catch(() => {})
  }, [])

  // Shared blank availability. A missing key means the pair is outside the blank
  // system (e.g. a stock not tracked), so treat it as available.
  const availableFor = (ct: string, dev: string) =>
    liveStock[`${ct}|${dev}`] ?? Infinity
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
        variantTitle: `${caseType} / ${device}`,
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
          variantTitle: `${caseType} / ${device}`,
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
      {/* Price - the selected variant's, 26px/600 to match the title. */}
      <p className="text-[1.625rem] font-semibold leading-none tracking-[-0.034em] tabular-nums">
        {formatPrice(price?.calculated_amount, price?.currency_code)}
      </p>

      {/* DEVICE - opens the same florayn SELECT MODEL drawer as the shop, but
          picks the device in place (no navigation). Order matches florayn:
          Device, then More designs, then Case type. */}
      <div className="mt-6">
        <p className="fl-pdp-label">DEVICE</p>
        <button
          type="button"
          onClick={() => setOpenModel(true)}
          aria-haspopup="dialog"
          className="flex h-[52px] w-full items-center justify-between rounded-[12px] border border-[#e2e2e2] bg-surface px-4 text-left text-base transition-colors hover:border-line-strong focus:border-purple focus:outline-none"
        >
          <span>{device || "Select a device"}</span>
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

      {moreDesigns}

      {/* CASE TYPE - in-page tiles, below Device + More designs to match
          florayn. A case type not sold for the selected device is disabled
          rather than hidden, so the range stays visible. */}
      {matrix.caseTypes.length > 1 ? (
        <section className="mt-6">
          <p className="fl-pdp-label">CASE TYPE</p>
          <ul className="flex flex-wrap gap-[10px]">
            {matrix.caseTypes.map((ct) => {
              const fits = (matrix.caseTypesByDevice[device] ?? []).includes(ct)
              const isCurrent = ct === caseType
              const soldOut = fits && availableFor(ct, device) <= 0
              const img = imageForCaseType(ct)
              const ctPrice = priceForCaseType(ct)
              return (
                <li key={ct}>
                  <button
                    type="button"
                    onClick={() => onSelectCaseType(ct)}
                    aria-pressed={isCurrent}
                    disabled={!fits && !isCurrent}
                    title={!fits ? `${ct} is not made for ${device}` : ct}
                    className={[
                      "flex h-[205px] w-[135px] flex-col overflow-hidden rounded-[10px] border bg-surface text-left transition-colors",
                      isCurrent
                        ? "border-purple"
                        : "border-[#e2e2e2] hover:border-purple",
                      (!fits && !isCurrent) || soldOut ? "opacity-40" : "",
                    ].join(" ")}
                  >
                    <span className="relative block h-[150px] w-full overflow-hidden rounded-t-[9px]">
                      <ProductImage
                        src={img}
                        alt={ct}
                        label={ct}
                        sizes="135px"
                      />
                    </span>
                    <span className="block px-2 py-2 text-center">
                      <span className="block text-[13px] font-semibold leading-tight">
                        {ct}
                      </span>
                      <span className="mt-0.5 block text-[13px] tabular-nums text-ink-muted">
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
          </ul>
        </section>
      ) : null}

      {/* Share - grey link above the cart form, matching florayn. */}
      <ShareButton title={productTitle} />

      {/* Quantity + add to cart + wishlist heart (one row, florayn layout). */}
      <div className="mt-2 flex items-stretch gap-[10px]">
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
        className="mt-[10px] flex h-[50px] w-full items-center justify-center gap-2 rounded-[30px] bg-purple px-6 text-[15px] font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
      >
        {buying ? <Spinner /> : null}
        {buying ? "Taking you to checkout..." : "Buy it now"}
      </button>

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
