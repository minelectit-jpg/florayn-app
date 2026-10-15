// Florayn Console (CONSOLE.md): our own admin on the same Medusa backend.
// Pages are addressed after the # (e.g. /console#/mockup-studio) because the
// backend serves the console from a single /console route.
import { StrictMode, useEffect, useState, type FormEvent } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"
import { login, logout, me, type User } from "./api"
import { Button, Field, Icon, Toaster } from "./ui"
import Home from "./pages/home"
import MockupStudio from "./pages/mockup-studio"
import Devices from "./pages/devices"

const PAGES = [
  { path: "/", label: "Home", icon: Icon.home, render: () => <Home /> },
  { path: "/mockup-studio", label: "Mockup Studio", icon: Icon.sparkles, render: () => <MockupStudio /> },
  { path: "/models", label: "Models", icon: Icon.phone, render: () => <Devices /> },
]

function useHashPath() {
  const read = () => window.location.hash.replace(/^#/, "") || "/"
  const [path, setPath] = useState(read)
  useEffect(() => {
    const on = () => setPath(read())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return path
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    try { await login(email.trim(), password); onDone() } catch (err: any) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="login"><form className="card" onSubmit={submit}>
    <div className="brand" style={{ padding: 0 }}><b>Florayn</b><span>Console</span></div>
    <p className="muted">Sign in with your admin account.</p>
    <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
    <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
    {error && <p className="note error">{error}</p>}
    <button className="btn primary" type="submit" disabled={busy}>{busy && <span className="spin" aria-hidden />}Sign in</button>
  </form></div>
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [error, setError] = useState("")
  const [menu, setMenu] = useState(false)
  const path = useHashPath()
  const check = () => { setError(""); me().then(setUser).catch((e) => setError(e.message)) }
  useEffect(check, [])
  useEffect(() => setMenu(false), [path])

  if (error) return <div className="login"><div className="card"><p className="note error">{error}</p><Button onClick={check}>Try again</Button></div></div>
  if (user === undefined) return null
  if (user === null) return <Login onDone={check} />

  const page = PAGES.find((p) => p.path === path) ?? PAGES[0]
  return <div className="shell">
    <aside className={`side${menu ? " open" : ""}`}>
      <div className="brand"><b>Florayn</b><span>Console</span></div>
      {PAGES.map((p) => <a key={p.path} className="nav" href={`#${p.path}`} aria-current={p === page ? "page" : undefined}>{p.icon}{p.label}</a>)}
      <div className="grow" />
      <a className="nav" href="/app" target="_blank" rel="noreferrer">{Icon.external}Classic admin</a>
      <div className="who"><span>{user.email}</span><Button size="small" variant="ghost" onClick={async () => { await logout(); setUser(null) }}>Sign out</Button></div>
    </aside>
    <div>
      <div className="topbar"><Button size="small" variant="ghost" aria-label="Menu" onClick={() => setMenu(!menu)}>{Icon.menu}</Button><div className="brand" style={{ padding: 0 }}><b>Florayn</b><span>Console</span></div></div>
      <main className="main">{page.render()}</main>
    </div>
    <Toaster />
  </div>
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
