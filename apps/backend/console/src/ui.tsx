// Small building blocks for the console (styles.css).
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react"

export function Button({ variant = "secondary", size, loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "small"; loading?: boolean }) {
  return <button type="button" {...rest} disabled={rest.disabled || loading} className={["btn", variant, size, rest.className].filter(Boolean).join(" ")}>
    {loading && <span className="spin" aria-hidden />}{children}
  </button>
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="faint">{hint}</small>}</label>
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={on} onClick={onClick}><span className="tick" aria-hidden />{children}</button>
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="segmented" role="group">{options.map(([key, label]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}</div>
}

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  return <div className="stack" style={{ gap: 6 }}><span className="faint">{label} ({done} / {total})</span>
    <div className="progress"><div style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} /></div></div>
}

// --- toasts: toast("Saved.", "success") from anywhere --------------------------------------------
type Toast = { id: number; text: string; kind: "info" | "error" | "success" }
export function toast(text: string, kind: Toast["kind"] = "info") {
  window.dispatchEvent(new CustomEvent("console-toast", { detail: { text, kind } }))
}
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)
  useEffect(() => {
    const on = (e: Event) => {
      const id = ++seq.current
      setItems((all) => [...all.slice(-3), { id, ...(e as CustomEvent).detail }])
      setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 5000)
    }
    window.addEventListener("console-toast", on)
    return () => window.removeEventListener("console-toast", on)
  }, [])
  return <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
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

export const slugify = (s: string) => s.toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

export const Icon = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>,
  sparkles: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>,
  phone: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M10.5 18.5h3" /></svg>,
  external: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>,
  menu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
}
