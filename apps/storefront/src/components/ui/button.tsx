import Link from "next/link"

/**
 * Every button and button-styled link in the store comes from here, so the
 * brand only has to be applied once. Purple is the accent, so it carries the
 * primary action; Ink is the quiet alternative for secondary confirmations.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "ink"
export type ButtonSize = "sm" | "md" | "lg"

const BASE =
  "inline-flex items-center justify-center gap-2 border font-medium " +
  "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-purple border-purple text-white hover:bg-purple-deep hover:border-purple-deep",
  ink: "bg-ink border-ink text-white hover:bg-purple hover:border-purple",
  secondary:
    "bg-transparent border-line-strong text-ink hover:border-ink hover:bg-surface",
  ghost:
    "bg-transparent border-transparent text-ink-muted hover:text-ink underline underline-offset-4",
}

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs tracking-wide",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-sm tracking-wide",
}

function classesFor(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth?: boolean,
  className?: string
): string {
  return [
    BASE,
    VARIANTS[variant],
    SIZES[size],
    fullWidth ? "w-full" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ")
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={classesFor(variant, size, fullWidth, className)}
    />
  )
}

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  fullWidth,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link {...props} className={classesFor(variant, size, fullWidth, className)} />
  )
}

/** The inline spinner used inside buttons while an action is in flight. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current motion-reduce:animate-none ${className}`}
    />
  )
}
