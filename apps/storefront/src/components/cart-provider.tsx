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
  addToCart as addToCartAction,
  getCartSummary,
  type AddedLine,
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
  isDrawerOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
  /** Replaces the summary after a mutation made elsewhere (the cart page). */
  applySummary: (summary: CartSummary) => void
  add: (
    variantId: string,
    quantity: number,
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
          setSummary({ itemCount: 0, subtotal: 0, currencyCode: "bdt" })
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
      optimistic: OptimisticLine
    ) => {
      const seq = ++requestSeq.current

      // Show the result before the round trip finishes. Both of these are
      // replaced by the server's numbers below.
      setSummary((current) => ({
        itemCount: (current?.itemCount ?? 0) + quantity,
        subtotal:
          (current?.subtotal ?? 0) + optimistic.unitPrice * quantity,
        currencyCode: current?.currencyCode ?? "bdt",
      }))
      setLastAdded({
        id: `optimistic-${variantId}`,
        productTitle: optimistic.productTitle,
        variantTitle: optimistic.variantTitle,
        sku: null,
        quantity,
        unitPrice: optimistic.unitPrice,
        thumbnail: optimistic.thumbnail,
      })
      setDrawerOpen(true)

      try {
        const { summary: serverSummary, added } = await addToCartAction(
          variantId,
          quantity
        )
        if (seq !== requestSeq.current) {
          return
        }
        setSummary(serverSummary)
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
      }
    },
    []
  )

  const value = useMemo(
    () => ({
      summary,
      lastAdded,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      applySummary,
      add,
    }),
    [summary, lastAdded, isDrawerOpen, openDrawer, closeDrawer, applySummary, add]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
