import { ChevronDown, FileText, ListChecks, MessageCircle } from "lucide-react"
import { defaultProductFaqs, type ProductContent } from "@/lib/product-content"

/** Native disclosure panels retain the complete copy in server HTML. */
export default function ProductTabs({ description, facts, content, isCase }: {
  description?: string | null
  facts: { label: string; value: string }[]
  content: ProductContent
  isCase: boolean
}) {
  const rows = content.facts ?? facts
  const faqs = content.faqs ?? defaultProductFaqs(isCase)
  return <div className="fl-product-copy">
    {description?.trim() ? <details open className="fl-product-copy__panel">
      <summary><FileText size={18} aria-hidden="true" /><h2>{content.description_heading}</h2><ChevronDown size={17} aria-hidden="true" /></summary>
      <div className="fl-product-copy__text">{description.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div>
    </details> : null}
    {rows.length ? <details className="fl-product-copy__panel">
      <summary><ListChecks size={18} aria-hidden="true" /><h2>{content.information_heading}</h2><ChevronDown size={17} aria-hidden="true" /></summary>
      <dl className="fl-product-facts">{rows.map((r, i) => <div key={i}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
    </details> : null}
    {faqs.length ? <section className="fl-product-faq">
      <h2><MessageCircle size={18} aria-hidden="true" />{content.faq_heading}<span>FAQ</span></h2>
      <div>{faqs.map((faq, i) => <details key={i}>
        <summary><h3>{faq.question}</h3><ChevronDown size={16} aria-hidden="true" /></summary>
        <p>{faq.answer}</p>
      </details>)}</div>
    </section> : null}
  </div>
}

