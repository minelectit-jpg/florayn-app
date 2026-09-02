import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Privacy policy",
  alternates: { canonical: "/privacy/" },
}

/**
 * A placeholder. The live site has this page, and the footer links to it, so
 * the route exists rather than 404s - but the wording is a legal document and
 * has to come from the business, not be invented here.
 */
export default function Page() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-10">
      <h1 className="display text-[2.25rem] leading-tight">Privacy policy</h1>
      <p className="text-ink-muted">
        This page has not been written yet. The wording needs to come from
        Florayn rather than be drafted here.
      </p>
      <p className="text-sm text-ink-muted">
        In the meantime,{" "}
        <Link
          href="/contact/"
          className="underline underline-offset-4 transition-colors hover:text-purple"
        >
          contact us
        </Link>{" "}
        with any question about an order.
      </p>
    </div>
  )
}
