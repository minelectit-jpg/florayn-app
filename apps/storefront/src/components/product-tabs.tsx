import { ChevronDown, FileText, ListChecks, MessageCircle, Plus, Star, Truck, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { defaultProductFaqs, type ProductContent } from "@/lib/product-content"

/** A row the page builds on the server and hands in (reviews, delivery). */
export type AccordionSlot = { label: string; meta?: ReactNode; body: ReactNode }

/**
 * Everything below the purchase buttons as one bordered list of native
 * disclosures: description, reviews, delivery, product details and FAQs. Each
 * row is closed until tapped, but its whole content is in the server HTML.
 * Rows only appear when they have content.
 */
export default function ProductTabs({ description, facts, content, isCase, reviews, delivery }: {
  description?: string | null
  facts: { label: string; value: string }[]
  content: ProductContent
  isCase: boolean
  /** The Reviews row; its id is the #customer-reviews link target. */
  reviews?: AccordionSlot | null
  delivery?: AccordionSlot | null
}) {
  const rows = content.facts ?? facts
  const faqs = content.faqs ?? defaultProductFaqs(isCase)
  const text = description?.trim()
  if (!text && !reviews && !delivery && !rows.length && !faqs.length) return null
  return <div className="fl-acc">
    {text ? <Row icon={FileText} label={content.description_heading}>
      <div className="fl-acc__text">{text.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div>
    </Row> : null}
    {reviews ? <Row id="customer-reviews" icon={Star} label={reviews.label} meta={reviews.meta}>{reviews.body}</Row> : null}
    {delivery ? <Row icon={Truck} label={delivery.label}>{delivery.body}</Row> : null}
    {rows.length ? <Row icon={ListChecks} label={content.information_heading}>
      <dl className="fl-product-facts">{rows.map((r, i) => <div key={i}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
    </Row> : null}
    {faqs.length ? <Row icon={MessageCircle} label={content.faq_heading}>
      <div className="fl-acc__faq">{faqs.map((faq, i) => <details key={i}>
        <summary><h3>{faq.question}</h3><ChevronDown size={16} aria-hidden="true" /></summary>
        <p>{faq.answer}</p>
      </details>)}</div>
    </Row> : null}
  </div>
}

function Row({ id, icon: Icon, label, meta, children }: {
  id?: string
  icon: LucideIcon
  label: string
  meta?: ReactNode
  children: ReactNode
}) {
  return <details id={id} className="fl-acc__item">
    <summary className="fl-acc__row">
      <Icon className="fl-acc__icon" size={16} aria-hidden="true" />
      <h2 id={id ? `${id}-heading` : undefined} className="fl-acc__label">{label}</h2>
      {meta ? <span className="fl-acc__meta">{meta}</span> : null}
      <Plus className="fl-acc__plus" size={20} strokeWidth={1.6} aria-hidden="true" />
    </summary>
    <div className="fl-acc__panel">{children}</div>
  </details>
}
