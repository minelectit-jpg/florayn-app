"use client"

import { Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"
import { sortNewestFirst } from "@/lib/device-order"
import { cn } from "@/lib/utils"

/**
 * The "SELECT MODEL" drawer, matched to florayn.com and shared by the shop
 * selector and the product page's device picker: a left slide-in with a grey
 * search, family-grouped rows, a purple "Selected" flag and an optional per-row
 * note (e.g. "Sold out"). Groups keep the caller's order; inside a group the
 * newest model is first (17, 16, 15...). The caller owns the open state and
 * decides what selecting a value does (navigate vs. pick in place).
 */
export type ModelItem = {
  value: string
  label: string
  /** The group heading this row sits under (e.g. "iPhone"). */
  group: string
  /** Shown at the right when the row is not the current one (e.g. "Sold out"). */
  note?: string | null
}

export default function ModelDrawer({
  open,
  onOpenChange,
  items,
  current,
  onSelect,
  title = "Select model",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ModelItem[]
  current: string
  onSelect: (value: string) => void
  title?: string
}) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const map = new Map<string, ModelItem[]>()
    for (const it of sortNewestFirst(items, (i) => i.label, (i) => i.group)) {
      if (needle && !it.label.toLowerCase().includes(needle)) continue
      const arr = map.get(it.group) ?? []
      arr.push(it)
      map.set(it.group, arr)
    }
    return [...map.entries()]
  }, [items, query])

  const matchCount = grouped.reduce((n, [, l]) => n + l.length, 0)

  return (
    <Drawer
      direction="left"
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setQuery("")
      }}
    >
      <DrawerContent className="bg-white data-[vaul-drawer-direction=left]:w-full data-[vaul-drawer-direction=left]:sm:max-w-[400px]">
        <div className="relative border-b border-[#ededed] px-[52px] py-4 text-center">
          <DrawerClose
            aria-label="Close"
            className="absolute left-4 top-1/2 grid size-6 -translate-y-1/2 place-items-center text-ink transition-opacity hover:opacity-60"
          >
            <X className="size-[18px]" strokeWidth={1.5} />
          </DrawerClose>
          <DrawerTitle className="text-[14px] font-semibold uppercase tracking-[1.12px] text-[#111]">
            {title}
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Choose a device
          </DrawerDescription>
        </div>

        <div className="flex items-center gap-2.5 bg-[#f5f5f5] px-4 py-3">
          <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={1.6} />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search"
            className="w-full border-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {matchCount === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">
              No model matches &ldquo;{query}&rdquo;.
            </p>
          ) : (
            grouped.map(([group, list]) => (
              <div key={group}>
                <p className="px-5 pb-1.5 pt-4 text-[15px] font-semibold text-[#111]">
                  {group}
                </p>
                {list.map((it) => {
                  const isCurrent = it.value === current
                  return (
                    <button
                      key={it.value}
                      type="button"
                      onClick={() => onSelect(it.value)}
                      aria-pressed={isCurrent}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-[15px] text-[#111] transition-colors hover:bg-[#f7f7f7] sm:py-2.5 sm:text-[14px]",
                        isCurrent ? "font-semibold" : "font-normal"
                      )}
                    >
                      <span>{it.label}</span>
                      {isCurrent ? (
                        <span className="text-[11px] font-semibold uppercase tracking-[0.66px] text-purple">
                          Selected
                        </span>
                      ) : it.note ? (
                        <span className="text-[11px] text-ink-faint">{it.note}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
