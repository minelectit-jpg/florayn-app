// Small building blocks for the console (styles.css).
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "small"; loading?: boolean; icon?: ReactNode }

/**
 * A button; while loading the spinner takes the icon's place, so the button keeps its width. A loading button stays
 * focusable (aria-busy, aria-disabled, clicks ignored), so keyboard focus is not dropped; disabled stays disabled.
 */
export function Button({ variant = "secondary", size, loading, icon, children, onClick, ...rest }: ButtonProps) {
  return <button type="button" {...rest} aria-busy={loading || undefined} aria-disabled={loading || rest["aria-disabled"] || undefined}
    onClick={loading ? undefined : onClick} className={["btn", variant, size, rest.className].filter(Boolean).join(" ")}>
    {loading ? <span className="spin" aria-hidden /> : icon}{children}
  </button>
}

/** A round icon-only button; label is its accessible name and tooltip. Loading works as in Button. */
export function IconButton({ label, icon, className, loading, onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode; loading?: boolean }) {
  return <button type="button" {...rest} aria-label={label} title={label} aria-busy={loading || undefined} aria-disabled={loading || rest["aria-disabled"] || undefined}
    onClick={loading ? undefined : onClick} className={["icon-btn", className].filter(Boolean).join(" ")}>
    {loading ? <span className="spin" aria-hidden /> : icon}
  </button>
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={["skel", className].filter(Boolean).join(" ")} aria-hidden />
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted ms-small">{hint}</small>}</label>
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={on} onClick={onClick}><span className="tick" aria-hidden />{children}</button>
}

export function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string; disabled?: boolean }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(([key, text]) => <button key={key} type="button" disabled={disabled} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}</div>
}

/** A progress bar; with a label, "{label} ({done} / {total})" sits above it. */
export function Progress({ done, total, label, name }: { done: number; total: number; label?: string; name?: string }) {
  const max = Math.max(1, total)
  return <div className="stack" style={{ gap: 6 }}>{label && <span className="faint">{label} ({done} / {total})</span>}
    <div className="progress" role="progressbar" aria-label={name ?? label ?? "Progress"} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(done, max)}><div style={{ width: `${Math.round((done / max) * 100)}%` }} /></div></div>
}

// --- toasts: toast("Saved.", "success") from anywhere --------------------------------------------
type Toast = { id: number; text: string; kind: "info" | "error" | "success" }
export function toast(text: string, kind: Toast["kind"] = "info") {
  window.dispatchEvent(new CustomEvent("console-toast", { detail: { text, kind } }))
}
/** Shows the toasts. A second one inside a modal <dialog> takes them while it is open (the page behind is inert). */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = (e: Event) => {
      const inner = document.querySelector("dialog[open] .toasts")
      if (inner && inner !== box.current) return
      const id = ++seq.current
      setItems((all) => [...all.slice(-3), { id, ...(e as CustomEvent).detail }])
      setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 5000)
    }
    window.addEventListener("console-toast", on)
    return () => window.removeEventListener("console-toast", on)
  }, [])
  return <div ref={box} className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
}

/** Warn before leaving the page with unsaved work. */
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
}

// The question to ask before the console moves to another page (main.tsx); null when nothing would be lost.
let guard: string | null = null
/** Asks before a reload/close (the browser's own text) and before another console page opens (this message). */
export function useLeaveGuard(message: string | null) {
  useUnsaved(Boolean(message))
  useEffect(() => {
    guard = message
    return () => { if (guard === message) guard = null }
  }, [message])
}
/** True when the console may move to another page. */
export const confirmLeave = () => !guard || window.confirm(guard)

export const slugify = (s: string) => s.toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

const svg = (children: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>

export const Icon = {
  home: svg(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />),
  sparkles: svg(<><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>),
  phone: svg(<><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M10.5 18.5h3" /></>),
  external: svg(<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>),
  menu: svg(<path d="M4 7h16M4 12h16M4 17h16" />),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  download: svg(<path d="M12 4v11 M7 10.5l5 5 5-5 M5 20h14" />),
  upload: svg(<path d="M12 20V9 M7 13.5l5-5 5 5 M5 4h14" />),
  arrowLeft: svg(<path d="M19 12H5 M11 6l-6 6 6 6" />),
  arrowRight: svg(<path d="M5 12h14 M13 6l6 6-6 6" />),
  chevronLeft: svg(<path d="M15 6l-6 6 6 6" />),
  chevronRight: svg(<path d="M9 6l6 6-6 6" />),
  close: svg(<path d="M6 6l12 12 M18 6L6 18" />),
  expand: svg(<path d="M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5" />),
  plus: svg(<path d="M12 5v14 M5 12h14" />),
  minus: svg(<path d="M5 12h14" />),
  undo: svg(<path d="M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3" />),
  centre: svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /></>),
  alert: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5 M12 16.5v.01" /></>),
  image: svg(<><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>),
  share: svg(<path d="M12 3v12 M8 7l4-4 4 4 M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />),
}
