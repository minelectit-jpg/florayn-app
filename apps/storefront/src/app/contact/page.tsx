import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Reach Florayn by phone, email or at our Dhaka address. Delivery, exchanges and order questions.",
  alternates: { canonical: "/contact/" },
}

const DETAILS = [
  {
    label: "Phone",
    value: "+880 1310-007055",
    href: "tel:+8801310007055",
    note: "Saturday to Thursday, 10am - 8pm",
  },
  {
    label: "Email",
    value: "info@florayn.com",
    href: "mailto:info@florayn.com",
    note: "We reply within one working day",
  },
]

const FAQ = [
  {
    q: "How long does delivery take?",
    a: "Three to five days across Bangladesh. Delivery is 60৳ inside Dhaka and 100৳ outside, and free once your order reaches 3,400৳.",
  },
  {
    q: "Can I exchange a case?",
    a: "Yes - within three days of delivery, as long as the case is unused and in its packaging. Message us first so we can arrange the pickup.",
  },
  {
    q: "How do I pay?",
    a: "Cash on delivery. You pay the courier when the parcel reaches you.",
  },
  {
    q: "My device is not listed.",
    a: "Tell us which model you have. Not every design is cut for every body, but we can say what is available and when a new one is coming.",
  },
]

/**
 * The live site sends "Contact Us" to its Facebook page. This is the real
 * page that replaces it, built from the contact details in the footer.
 */
export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-12 py-4">
      <header className="space-y-3">
        <p className="eyebrow">Contact</p>
        <h1 className="display text-[2.25rem] leading-tight md:text-[3rem]">
          Talk to us
        </h1>
        <p className="max-w-prose text-ink-muted">
          Questions about an order, a device we do not list yet, or an exchange
          - the fastest answer is a phone call.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {DETAILS.map((detail) => (
          <div
            key={detail.label}
            className="rounded-[12px] border border-line bg-surface p-6"
          >
            <p className="eyebrow">{detail.label}</p>
            <a
              href={detail.href}
              className="mt-2 block text-lg font-semibold transition-colors hover:text-purple"
            >
              {detail.value}
            </a>
            <p className="mt-1 text-[13px] text-ink-muted">{detail.note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[12px] border border-line bg-surface p-6">
        <p className="eyebrow">Address</p>
        <address className="mt-2 not-italic leading-relaxed text-ink-muted">
          Plot #H-2 (1st Floor), Block-H, Sector-2, Avenue-10
          <br />
          Zahurul Islam City (Aftabnagar Eastern Housing Project)
          <br />
          Dhaka-1212, Bangladesh
        </address>
      </section>

      <section className="space-y-4">
        <h2 className="display text-2xl">Common questions</h2>
        <dl className="divide-y divide-line border-y border-line">
          {FAQ.map((item) => (
            <div key={item.q} className="py-5">
              <dt className="font-semibold">{item.q}</dt>
              <dd className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-muted">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
