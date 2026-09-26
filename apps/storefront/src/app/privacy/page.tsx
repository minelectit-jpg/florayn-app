import type { Metadata } from "next"
import Link from "next/link"

import { getPrivacy, parsePrivacyBody } from "@/lib/privacy"

export const revalidate = 60

export const metadata: Metadata = {
  title: "Privacy policy",
  alternates: { canonical: "/privacy/" },
}

const DHAKA_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  day: "numeric",
  month: "long",
  year: "numeric",
})

const LINK = "underline underline-offset-4 transition-colors hover:text-purple"

/**
 * The policy Florayn publishes in Admin > Privacy, rendered as plain text.
 * Until it is published, or when the backend cannot be reached, the page stays
 * a placeholder: the wording is a legal document and has to come from the
 * business, not be invented here.
 */
export default async function Page() {
  const privacy = await getPrivacy()
  const blocks = privacy?.published ? parsePrivacyBody(privacy.body) : []
  if (!privacy || !blocks.length) return <Placeholder />
  const updated = privacy.updated_at ? DHAKA_DATE.format(new Date(privacy.updated_at)) : null

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-10">
      <h1 className="display text-[2.25rem] leading-tight">{privacy.title}</h1>
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <h2 key={index} className="display pt-4 text-2xl leading-snug">{block.text}</h2>
        ) : block.kind === "list" ? (
          <ul key={index} className="list-disc space-y-1.5 pl-5 leading-relaxed">
            {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
          </ul>
        ) : (
          <p key={index} className="whitespace-pre-line leading-relaxed">{block.text}</p>
        )
      )}
      {updated ? <p className="text-sm text-ink-muted">Last updated {updated}</p> : null}
      {/* Plain links, never prefetched: /api/t/optout/ sets or clears the
          opt-out cookie (TRACKING.md 4.2 and 12). */}
      <p className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5 text-sm">
        <a href="/api/t/optout/?on=1" rel="nofollow" className={LINK}>Turn off ad measurement on this browser</a>
        <a href="/api/t/optout/?on=0" rel="nofollow" className={LINK}>Turn it back on</a>
      </p>
    </div>
  )
}

function Placeholder() {
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
