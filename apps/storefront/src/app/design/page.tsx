"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Internal preview of shadcn/ui matched to the Florayn brand. Not linked from
 * the site - open /design on the dev server. The dropdown below is stock shadcn
 * (copied into components/ui) but reads our bridged tokens, so it inherits our
 * ink text, purple-tint hover, radius and Instrument Sans - no default look.
 */
export default function DesignPreview() {
  const [sort, setSort] = useState("Featured")
  const [inStock, setInStock] = useState(true)

  return (
    <div className="space-y-10 py-8">
      <header className="space-y-1">
        <p className="eyebrow">Design</p>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">
          shadcn/ui &mdash; matched to Florayn
        </h1>
        <p className="text-sm text-ink-muted">
          Instrument Sans, ink #1A1625, purple accent #7C3AED, our radius &amp;
          borders &mdash; inherited from the bridged tokens, not shadcn defaults.
        </p>
      </header>

      {/* Our existing brand Button, kept as-is */}
      <section className="space-y-3">
        <p className="fl-pdp-label">Brand buttons (existing)</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Add to cart</Button>
          <Button variant="ink">Checkout</Button>
          <Button variant="secondary">View details</Button>
          <Button variant="ghost">Clear filters</Button>
        </div>
      </section>

      {/* shadcn Dropdown, brand-styled via bridged tokens */}
      <section className="space-y-3">
        <p className="fl-pdp-label">shadcn dropdown (brand-matched)</p>
        <div className="flex flex-wrap items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 py-2.5 text-sm transition-colors hover:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Sort: {sort}
              <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M3 5l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {["Featured", "Price: low to high", "Price: high to low", "Newest"].map(
                (option) => (
                  <DropdownMenuItem key={option} onClick={() => setSort(option)}>
                    {option}
                  </DropdownMenuItem>
                )
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={inStock}
                onCheckedChange={(v) => setInStock(!!v)}
              >
                In stock only
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="text-sm text-ink-muted">
            selected: {sort}
            {inStock ? " · in stock" : ""}
          </span>
        </div>
      </section>
    </div>
  )
}
