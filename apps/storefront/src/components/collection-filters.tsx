"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

export type FilterOption = { value: string; label: string }

/**
 * The row of pill dropdowns above the grid: Device, Case Type, Sort.
 *
 * Case Type only appears for devices that actually come in more than one
 * construction. AirPods, watch bands and wallets are made in a single finish,
 * so the pill is hidden for them rather than shown with one option.
 */
export default function CollectionFilters({
  devices,
  caseTypes,
  device,
  caseType,
  sort,
  showCaseType,
  resultLabel,
}: {
  devices: FilterOption[]
  caseTypes: FilterOption[]
  device: string
  caseType: string
  sort: string
  showCaseType: boolean
  resultLabel: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    // Changing device can invalidate the chosen case type, so drop it.
    if (key === "device") {
      next.delete("case_type")
    }
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    })
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 ${pending ? "opacity-60" : ""}`}
      aria-busy={pending}
    >
      <p className="mr-auto text-sm text-ink-muted">{resultLabel}</p>

      <Pill
        id="filter-device"
        label="Device"
        value={device}
        options={devices}
        onChange={(v) => update("device", v)}
      />

      {showCaseType ? (
        <Pill
          id="filter-case-type"
          label="Case type"
          value={caseType}
          options={[{ value: "", label: "All case types" }, ...caseTypes]}
          onChange={(v) => update("case_type", v)}
        />
      ) : null}

      <Pill
        id="filter-sort"
        label="Sort"
        value={sort}
        options={[
          { value: "featured", label: "Featured" },
          { value: "price-asc", label: "Price, low to high" },
          { value: "price-desc", label: "Price, high to low" },
          { value: "name", label: "Name, A to Z" },
        ]}
        onChange={(v) => update("sort", v)}
        className="max-sm:w-full"
      />
    </div>
  )
}

function Pill({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  id: string
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="fl-pill"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
