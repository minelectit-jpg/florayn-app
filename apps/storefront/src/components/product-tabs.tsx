"use client"

import { useState, type ReactNode } from "react"

import { DesignReviews } from "@/components/product-sections"

type Tab = { id: string; label: string; panel: ReactNode }

/**
 * The live page groups the copy into Description / Additional information /
 * Reviews. Description carries the product copy and the case-type copy; both
 * are shown because a design has no description of its own in this build.
 */
export default function ProductTabs({
  description,
  caseTypeName,
  caseTypeDescription,
  facts,
  designName,
}: {
  description?: string | null
  caseTypeName?: string | null
  caseTypeDescription?: string | null
  /** Rows for Additional information. */
  facts: { label: string; value: string }[]
  /**
   * The reviews panel is built here from the design name rather than passed in
   * as JSX. A server-rendered element with several static children loses its
   * static marker crossing into a client component, and React then treats the
   * children as a keyless array and warns.
   */
  designName: string
}) {
  const tabs: Tab[] = [
    {
      id: "description",
      label: "Description",
      panel: (
        <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
          {description
            ? description
                .split("\n\n")
                .map((para, i) => <p key={i}>{para}</p>)
            : null}
          {caseTypeDescription && caseTypeDescription !== description ? (
            <div>
              <p className="mb-1 font-semibold text-ink">{caseTypeName}</p>
              <p>{caseTypeDescription}</p>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "additional",
      label: "Additional information",
      panel: (
        <dl className="divide-y divide-line text-sm">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-6 py-2.5">
              <dt className="w-40 shrink-0 font-semibold">{fact.label}</dt>
              <dd className="text-ink-muted">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      id: "reviews",
      label: "Reviews",
      panel: <DesignReviews designName={designName} />,
    },
  ]

  const [active, setActive] = useState(tabs[0].id)

  return (
    <div className="mt-8">
      <div role="tablist" className="flex gap-6 border-b border-line">
        {tabs.map((tab) => {
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={[
                "-mb-px border-b-2 pb-3 text-base font-semibold transition-colors",
                isActive
                  ? "border-purple text-ink"
                  : "border-transparent text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== active}
          className="pt-5"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  )
}
