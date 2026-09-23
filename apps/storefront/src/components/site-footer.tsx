import Link from "@/components/audience-link"
import { ArrowUpRight, ExternalLink } from "lucide-react"
import type { MenuSection } from "@/lib/content"
import { readPresentation, safePresentationHref, type FooterPresentation } from "@/lib/storefront-presentation"
import FooterLinks from "./footer-links"

function SocialIcon({ label }: { label: string }) {
  const name = label.toLowerCase()
  if (name === "facebook") return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 21v-8h3l.5-4H14V7c0-1 .3-2 2-2h2V1.5c-.7-.1-1.8-.3-3-.3-3 0-5 1.8-5 5.2V9H7v4h3v8z" /></svg>
  if (name === "instagram") return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
  if (name === "youtube") return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 6 3-6 3z" fill="currentColor" stroke="none" /></svg>
  return <ExternalLink size={18} strokeWidth={1.7} aria-hidden="true" />
}

export default function SiteFooter({ columns, note, social, appearance }: {
  columns: MenuSection[]
  note: string
  social: { label: string; href: string }[]
  appearance?: FooterPresentation
}) {
  const footer = readPresentation({ footer: appearance }).footer
  return <footer data-site-footer className="fl-footer">
    <div className="fl-footer__inner">
      <div className="fl-footer__top">
        <div>
          <Link href="/" prefetch={false} className="fl-footer__brand" aria-label={`${footer.brand} home`}>{footer.brand}</Link>
          {footer.tagline && <p className="fl-footer__tagline">{footer.tagline}</p>}
        </div>
        {(footer.support_title || footer.support_text || footer.support_label) && <div className="fl-footer__support">
          <div>{footer.support_title && <h2>{footer.support_title}</h2>}{footer.support_text && <p>{footer.support_text}</p>}</div>
          {footer.support_label && safePresentationHref(footer.support_href) && <Link href={footer.support_href} prefetch={false} className="fl-footer__support-link">
            {footer.support_label}<ArrowUpRight size={18} aria-hidden="true" />
          </Link>}
        </div>}
      </div>
      {columns.length > 0 && <FooterLinks columns={columns} />}
      <div className="fl-footer__bottom">
        <div className="fl-footer__notes">{note && <p>{note}</p>}{footer.location && <p>{footer.location}</p>}</div>
        {social.length > 0 && <ul className="fl-footer__social" aria-label="Follow Florayn">
          {social.filter((item) => safePresentationHref(item.href)).map((item, index) => {
            return <li key={index}><a href={item.href} target="_blank" rel="noopener noreferrer" aria-label={`${item.label} (opens in a new tab)`} title={item.label}>
              <SocialIcon label={item.label} />
            </a></li>
          })}
        </ul>}
      </div>
    </div>
  </footer>
}
