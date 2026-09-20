"use client"

import { useEffect, useRef, useState } from "react"

import { SHOP_PRIORITY_IMAGES, watchShopImages } from "@/lib/shop-image-loading"

function initialBatch(key: string) {
  return { key, released: false, admitted: new Set<number>() }
}

export function useShopImageLoading(key: string) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [batch, setBatch] = useState(() => initialBatch(key))
  // Reset before children commit: an effect-only reset could briefly mount all
  // images from a new model/sort using the preceding batch's released state.
  const current = batch.key === key ? batch : initialBatch(key)
  if (batch.key !== key) setBatch(current)

  useEffect(() => {
    if (!gridRef.current) return
    return watchShopImages(gridRef.current, (index) => {
      setBatch((state) => state.key !== key || state.released || state.admitted.has(index)
        ? state
        : { ...state, admitted: new Set(state.admitted).add(index) })
    }, () => {
      setBatch((state) => state.key !== key || state.released ? state : { ...state, released: true })
    })
  }, [key])

  return {
    gridRef,
    deferred: (index: number) => index >= SHOP_PRIORITY_IMAGES && !current.released && !current.admitted.has(index),
  }
}
