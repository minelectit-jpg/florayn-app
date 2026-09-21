import type { Metadata } from "next"
import { ArrowDown, ArrowUpRight, Mail, MapPin, MessageCircle, Phone, Plus } from "lucide-react"

import { getContactSettings } from "@/lib/contact"
import "./contact.css"

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getContactSettings()
  return { title: settings.title, description: settings.description, alternates: { canonical: "/contact/" } }
}

export default async function ContactPage() {
  const settings = await getContactSettings()
  const channels = [
    { key: "phone", label: settings.phone_label, value: settings.phone, note: settings.phone_note, href: `tel:${settings.phone}`, icon: Phone },
    { key: "email", label: settings.email_label, value: settings.email, note: settings.email_note, href: `mailto:${settings.email}`, icon: Mail },
  ].filter((channel) => channel.value)
  const hasFaqs = settings.faqs.length > 0

  return <div className="contact-page" data-contact-page>
    <header className="contact-hero">
      <div className="contact-hero-copy">
        {settings.eyebrow ? <p className="contact-eyebrow">{settings.eyebrow}</p> : null}
        <h1>{settings.title}</h1>
        {settings.description ? <p className="contact-description">{settings.description}</p> : null}
      </div>
      {hasFaqs ? <a href="#contact-faq" className="contact-faq-jump"><MessageCircle size={19} aria-hidden="true" /><span>{settings.faq_title}</span><ArrowDown size={16} aria-hidden="true" /></a> : null}
    </header>
    {channels.length ? <section className="contact-channels" aria-label="Contact options">
      {channels.map(({ key, label, value, note, href, icon: Icon }) => <a key={key} href={href} className="contact-channel">
        <div className="contact-channel-top"><span className="contact-icon"><Icon size={23} strokeWidth={1.6} aria-hidden="true" /></span><ArrowUpRight size={21} className="contact-link-arrow" aria-hidden="true" /></div>
        <h2>{label}</h2><p className="contact-channel-value">{value}</p>
        {note ? <p className="contact-channel-note">{note}</p> : null}
      </a>)}
    </section> : null}
    {settings.address ? <section className="contact-address" aria-labelledby="contact-address-heading">
      <span className="contact-icon"><MapPin size={23} strokeWidth={1.6} aria-hidden="true" /></span>
      <div><h2 id="contact-address-heading">{settings.address_label}</h2><address>{settings.address}</address></div>
      {settings.address_note ? <p>{settings.address_note}</p> : null}
    </section> : null}
    {hasFaqs ? <section className="contact-faq" id="contact-faq" aria-labelledby="contact-faq-heading">
      <div className="contact-faq-intro">
        {settings.faq_eyebrow ? <p className="contact-eyebrow">{settings.faq_eyebrow}</p> : null}
        <h2 id="contact-faq-heading">{settings.faq_title}</h2>
        {settings.faq_description ? <p>{settings.faq_description}</p> : null}
        <span className="contact-faq-mark" aria-hidden="true"><MessageCircle size={32} strokeWidth={1.25} /></span>
      </div>
      <div className="contact-faq-list">
        {settings.faqs.map((faq, index) => <details key={faq.id} name="contact-questions" open={index === 0} className="contact-faq-item">
          <summary><span className="contact-faq-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h3>{faq.question}</h3><span className="contact-faq-toggle"><Plus size={18} aria-hidden="true" /></span></summary>
          <div className="contact-faq-answer"><p>{faq.answer}</p></div>
        </details>)}
      </div>
    </section> : null}
    {channels.length > 0 && (settings.help_title || settings.help_description) ? <section className="contact-help" aria-label={settings.help_title || "Contact support"}>
      <span className="contact-help-icon"><MessageCircle size={26} strokeWidth={1.5} aria-hidden="true" /></span>
      <div>{settings.help_title ? <h2>{settings.help_title}</h2> : null}{settings.help_description ? <p>{settings.help_description}</p> : null}</div>
      <div className="contact-help-actions">{channels.map(({ key, label, href, icon: Icon }) => <a key={key} href={href}><Icon size={15} aria-hidden="true" />{label}<ArrowUpRight size={14} aria-hidden="true" /></a>)}</div>
    </section> : null}
  </div>
}
