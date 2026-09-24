"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  addManyToCart as addManyToCartAction,
  addToCart as addToCartAction,
  getCartSummary,
  type AddedLine,
  type CartItem,
  type CartSummary,
} from "@/lib/cart"

type OptimisticLine = {
  productTitle: string
  variantTitle: string
  unitPrice: number
  thumbnail: string | null
}

type CartContextValue = {
  /** null until the summary has been fetched, so the badge can stay hidden. */
  summary: CartSummary | null
  lastAdded: AddedLine | null
  /**
   * The bag's lines as last read from the server, or null before the first
   * read. Every add hands the new list back, so the drawer shows it at once.
   */
  items: CartItem[] | null
  setItems: (items: CartItem[]) => void
  /** An add is on its way; the drawer shows the new line optimistically. */
  adding: boolean
  isDrawerOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
  /** Replaces the summary after a mutation made elsewhere (the cart page). */
  applySummary: (summary: CartSummary) => void
  add: (
    variantId: string,
    quantity: number,
    optimistic: OptimisticLine,
    options?: { openDrawer?: boolean }
  ) => Promise<void>
  /** Add several variants at once (a 2-pack / 3-pack / bundle). */
  addMany: (
    items: { variantId: string; quantity?: number }[],
    optimistic: OptimisticLine
  ) => Promise<void>
}

const CartContext = createContext<CartContextValue | null>(null)

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error("useCart must be used inside <CartProvider>")
  }
  return context
}

export default function CartProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [summary, setSummary] = useState<CartSummary | null>(null)
  const [lastAdded, setLastAdded] = useState<AddedLine | null>(null)
  const [items, setItems] = useState<CartItem[] | null>(null)
  const [inFlight, setInFlight] = useState(0)
  const [isDrawerOpen, setDrawerOpen] = useState(false)
  // Guards against a slow first add resolving after a faster second one and
  // overwriting the newer total.
  const requestSeq = useRef(0)

  // The cart lives in an httpOnly cookie, so the count cannot be part of a
  // statically rendered page. Hydrating it here keeps every page cacheable.
  useEffect(() => {
    let cancelled = false
    getCartSummary()
      .then((s) => {
        if (!cancelled) {
          setSummary(s)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary({
            itemCount: 0,
            subtotal: 0,
            currencyCode: "bdt",
            bundleDiscount: 0,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const applySummary = useCallback((next: CartSummary) => setSummary(next), [])

  const add = useCallback(
    async (
      variantId: string,
      quantity: number,
      optimistic: OptimisticLine,
      options?: { openDrawer?: boolean }
    ) => {
      const seq = ++requestSeq.current

      // Show the result before the round trip finishes. Both of these are
      // replaced by the server's numbers below.
      setSummary((current) => ({
        itemCount: (current?.itemCount ?? 0) + quantity,
        subtotal:
          (current?.subtotal ?? 0) + optimistic.unitPrice * quantity,
        currencyCode: current?.currencyCode ?? "bdt",
        bundleDiscount: current?.bundleDiscount ?? 0,
      }))
      setLastAdded({
        id: `optimistic-${variantId}`,
        variantId,
        productTitle: optimistic.productTitle,
        variantTitle: optimistic.variantTitle,
        sku: null,
        quantity,
        unitPrice: optimistic.unitPrice,
        thumbnail: optimistic.thumbnail,
      })
      // Buy-it-now goes straight to checkout, so it opts out of the drawer.
      if (options?.openDrawer !== false) setDrawerOpen(true)
      setInFlight((n) => n + 1)

      try {
        const { summary: serverSummary, added, items: serverItems } = await addToCartAction(
          variantId,
          quantity
        )
        if (seq !== requestSeq.current) {
          return
        }
        setSummary(serverSummary)
        setItems(serverItems)
        if (added) {
          setLastAdded(added)
        }
      } catch (error) {
        if (seq === requestSeq.current) {
          // Roll the optimistic bump back rather than leave a wrong count.
          setDrawerOpen(false)
          setLastAdded(null)
          getCartSummary()
            .then(setSummary)
            .catch(() => undefined)
        }
        throw error
      } finally {
        setInFlight((n) => n - 1)
      }
    },
    []
  )

  const addMany = useCallback(
    async (
      items: { variantId: string; quantity?: number }[],
      optimistic: OptimisticLine
    ) => {
      const seq = ++requestSeq.current
      const count = items.reduce((n, i) => n + (i.quantity ?? 1), 0)

      setSummary((current) => ({
        itemCount: (current?.itemCount ?? 0) + count,
        subtotal: (current?.subtotal ?? 0) + optimistic.unitPrice,
        currencyCode: current?.currencyCode ?? "bdt",
        bundleDiscount: current?.bundleDiscount ?? 0,
      }))
      setLastAdded({
        id: `optimistic-pack-${seq}`,
        productTitle: optimistic.productTitle,
        variantTitle: optimistic.variantTitle,
        sku: null,
        // One synthetic "pack" highlight priced at the pack total; the real
        // per-design lines replace it once the server responds.
        quantity: 1,
        unitPrice: optimistic.unitPrice,
        thumbnail: optimistic.thumbnail,
      })
      setDrawerOpen(true)
      setInFlight((n) => n + 1)

      try {
        const { summary: serverSummary, items: serverItems } = await addManyToCartAction(items)
        if (seq === requestSeq.current) {
          setSummary(serverSummary)
          setItems(serverItems)
        }
      } catch (error) {
        if (seq === requestSeq.current) {
          setDrawerOpen(false)
          setLastAdded(null)
          getCartSummary().then(setSummary).catch(() => undefined)
        }
        throw error
      } finally {
        setInFlight((n) => n - 1)
      }
    },
    []
  )

  const value = useMemo(
    () => ({
      summary,
      lastAdded,
      items,
      setItems,
      adding: inFlight > 0,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      applySummary,
      add,
      addMany,
    }),
    [
      summary,
      lastAdded,
      items,
      inFlight,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      applySummary,
      add,
      addMany,
    ]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
