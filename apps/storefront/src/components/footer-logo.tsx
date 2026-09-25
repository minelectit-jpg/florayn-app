"use client"

import FloraynLogo from "@/components/florayn-logo"

/**
 * The wordmark in the footer. A client module on purpose: the header shell
 * already ships florayn-logo in its cached chunk, so the ~2.5 KB path is not
 * repeated in every page's server payload.
 */
export default function FooterLogo() {
  return <FloraynLogo title={null} width={222} height={36} className="fl-footer__logo" />
}
