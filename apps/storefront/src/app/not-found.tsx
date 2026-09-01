import Link from "next/link"

export default function NotFound() {
  return (
    <div className="space-y-4 py-16">
      <p className="eyebrow">404</p>
      <h1 className="display text-[2.5rem] leading-tight">Not found</h1>
      <p className="text-ink-muted">
        That design, finish or collection does not exist.
      </p>
      <Link href="/" className="text-sm text-ink-muted underline underline-offset-4 transition-colors hover:text-purple">
        Back to the shop
      </Link>
    </div>
  )
}
