import Link from "next/link"

import type { MenuSection } from "@/lib/content"

/**
 * Four columns and a bar, as on the live site. The columns are data, so they
 * are reordered and edited from the admin rather than here.
 */
export default function SiteFooter({
  columns,
  note,
  social,
}: {
  columns: MenuSection[]
  note: string
  social: { label: string; href: string }[]
}) {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-[1470px] px-[15px] py-14 md:px-[30px]">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {columns.map((column) => (
            <div key={column.id}>
              <p className="eyebrow mb-4">{column.label}</p>
              <ul className="space-y-2.5">
                {column.groups
                  .flatMap((group) => group.links)
                  .map((link) => (
                    <li key={link.id}>
                      <Link
                        href={link.href}
                        className="text-sm leading-relaxed text-ink-muted transition-colors hover:text-purple"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>

        {social.length ? (
          <ul className="mt-10 flex flex-wrap gap-4 border-t border-line pt-6">
            {social.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-ink-muted transition-colors hover:text-purple"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="border-t border-line">
        <div className="mx-auto w-full max-w-[1470px] px-[15px] py-5 md:px-[30px]">
          <p className="text-[13px] text-ink-muted">{note}</p>
        </div>
      </div>
    </footer>
  )
}
