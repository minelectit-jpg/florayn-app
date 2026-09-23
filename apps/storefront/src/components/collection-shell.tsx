import type { CSSProperties, ReactNode } from "react"

import type { CollectionTheme } from "@/lib/content"

/**
 * The themed ground of a collection landing page. The admin's theme becomes
 * CSS variables here: the brand tokens (so headings, filters and buttons pick
 * up the collection's colours) and the --fl-card-* variables the product card
 * reads. The card component is untouched; only its dressing changes.
 *
 * Without a theme (a plain collection or category) this is the store's own
 * look on the same layout.
 */
export default function CollectionShell({
  theme,
  children,
}: {
  theme: CollectionTheme | null
  children: ReactNode
}) {
  const style = theme
    ? ({
        "--cp-bg": theme.bg,
        "--cp-accent-text": theme.accent_text,
        "--cp-hero-bg": theme.hero_bg,
        "--cp-hero-text": theme.hero_text,
        "--color-ink": theme.text,
        "--color-ink-muted": theme.muted,
        "--color-ink-faint": theme.muted,
        "--color-line": theme.line,
        "--color-line-strong": theme.line,
        "--color-purple": theme.accent,
        "--color-purple-deep": theme.accent,
        "--fl-card-bg": theme.card_bg,
        "--fl-card-media-bg": theme.card_bg,
        "--fl-card-border": theme.card_border,
        "--fl-card-text": theme.card_text,
        "--fl-card-muted": theme.card_muted,
        "--fl-card-radius": `${theme.card_radius}px`,
      } as CSSProperties)
    : undefined

  return (
    <div
      className={`fl-cpage fl-cpage--${theme?.heading_size ?? "md"}`}
      style={style}
    >
      {children}
    </div>
  )
}
