"use client"

import { useId, useState } from "react"
import Link from "@/components/audience-link"
import { Plus, Minus } from "lucide-react"
import type { MenuSection } from "@/lib/content"
import { safePresentationHref } from "@/lib/storefront-presentation"

export default function FooterLinks({ columns }: { columns: MenuSection[] }) {
  const id = useId()
  const [open, setOpen] = useState<string[]>(columns[0] ? [columns[0].id] : [])
  return <nav aria-label="Footer" className="fl-footer__columns">
    {columns.map((column, index) => {
      const expanded = open.includes(column.id)
      const panelId = `${id}-footer-${index}`
      return <div key={column.id} className="fl-footer__column" data-open={expanded}>
        <h3 className="fl-footer__desktop-heading">{column.label}</h3>
        <button type="button" className="fl-footer__toggle" aria-expanded={expanded} aria-controls={panelId}
          onClick={() => setOpen((current) => expanded ? current.filter((key) => key !== column.id) : [...current, column.id])}>
          {column.label}{expanded ? <Minus size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
        </button>
        <div id={panelId} className="fl-footer__panel">
          {column.groups.map((group, groupIndex) => <div key={groupIndex}>
            {group.heading && <p className="fl-footer__group-heading">{group.heading}</p>}
            <ul>{group.links.filter((link) => safePresentationHref(link.href)).map((link) => <li key={link.id}>
              <Link prefetch={false} href={link.href}>{link.label}{link.badge && <span className="fl-footer__badge">{link.badge}</span>}</Link>
            </li>)}</ul>
          </div>)}
        </div>
      </div>
    })}
  </nav>
}
