import Link from "next/link"

export default function NotFound() {
  return (
    <div className="space-y-4 py-16">
      <h1 className="display text-4xl">Not found</h1>
      <p className="text-sm text-[var(--color-ink-soft)]">
        That design, finish or collection does not exist.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to the shop
      </Link>
    </div>
  )
}
