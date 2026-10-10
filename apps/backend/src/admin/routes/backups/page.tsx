// Admin > Backups (BACKUP.md): the encryption key (made here, in the browser),
// on/off and alerts, the Google Drive script and token, "back up now", the
// files on the server and the run history.
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CloudArrowUp } from "@medusajs/icons"
import { Alert, Badge, Button, Checkbox, Container, Heading, Input, Label, Switch, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"

type Settings = {
  enabled: boolean
  recipient: string | null
  pull_token_hint: string | null
  keep_local: number
  alert_email: string | null
  updated_at: string | null
  token_set: boolean
}
type Run = {
  id: string; kind: "db" | "env"; trigger: string; started_at: string; finished_at: string | null; ok: boolean
  file: string | null; bytes: number | null; tables: number | null; error: string | null; pulled_at: string | null
}
type LocalFile = { name: string; kind: string; bytes: number; modified: string }
type State = { settings: Settings; runs: Run[]; files: LocalFile[]; pull_url: string; script: string; email_configured: boolean }

const dhaka = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" })
const when = (iso: string | null) => (iso ? dhaka.format(new Date(iso)) : "never")
const size = (bytes: number | null) => bytes === null ? "" : bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

async function call(body?: object): Promise<State & { token?: string; result?: { status: string; reason: string | null } }> {
  const response = await fetch("/admin/backups", body
    ? { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : { credentials: "include" })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const errors = data?.errors ? Object.values(data.errors).join(" ") : ""
    throw new Error(errors || data?.message || "The server did not answer.")
  }
  return data
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const BackupsPage = () => {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [recipient, setRecipient] = useState("")
  const [keySaved, setKeySaved] = useState(false)
  const [newKey, setNewKey] = useState(false)
  const [alertEmail, setAlertEmail] = useState("")
  const [token, setToken] = useState("")

  const apply = (next: State) => {
    setState(next)
    setRecipient(next.settings.recipient ?? "")
    setAlertEmail(next.settings.alert_email ?? "")
  }
  useEffect(() => { call().then(apply).catch((e: Error) => setError(e.message)) }, [])

  async function act(label: string, body: object, done?: (data: Awaited<ReturnType<typeof call>>) => void) {
    setBusy(label)
    try {
      const data = await call(body)
      apply(data)
      done?.(data)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy("")
    }
  }

  async function createKey() {
    if (state?.settings.recipient && !window.confirm("Make a NEW key? Backups made with the old key can still only be opened with the old private key, so keep that file too.")) return
    const age = await import("age-encryption")
    const identity = await age.generateX25519Identity()
    const publicKey = await age.identityToRecipient(identity)
    download("florayn-backup-PRIVATE-key.txt", [
      `# Florayn backup PRIVATE key, created ${new Date().toISOString()}`,
      `# public key: ${publicKey}`,
      "# Keep this file on a USB stick AND as a printed copy. Never upload it to the",
      "# server, Google Drive, email or chat. Without it the backups cannot be opened.",
      identity,
      "",
    ].join("\n"))
    setRecipient(publicKey)
    setNewKey(true)
    setKeySaved(false)
  }

  if (error) return <Container><Text role="alert">{error}</Text></Container>
  if (!state) return <Container><Text role="status">Loading backups...</Text></Container>

  const s = state.settings
  const lastDb = state.runs.find((r) => r.kind === "db")
  const lastOk = state.runs.find((r) => r.kind === "db" && r.ok)
  const lastPulled = state.runs.filter((r) => r.pulled_at).map((r) => r.pulled_at!).sort().pop() ?? null
  const health = !s.enabled ? { color: "grey" as const, label: "Off" }
    : lastDb && !lastDb.ok ? { color: "red" as const, label: "Last backup failed" }
    : !s.token_set ? { color: "orange" as const, label: "Google Drive not connected" }
    : { color: "green" as const, label: "Working" }
  const keyDirty = (recipient.trim() || null) !== (s.recipient ?? null)

  return <div className="flex flex-col gap-y-4">
    <Container className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><Heading>Backups</Heading><Badge color={health.color}>{health.label}</Badge></div>
      <Text size="small" className="max-w-3xl text-ui-fg-subtle">
        Every hour the database is copied, checked and encrypted with your key, and a script in your Google account collects it into Google Drive.
        The server never holds a Google password, so even a hacked server cannot delete what is in Drive. Only your private key opens the files.
      </Text>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-ui-border-base p-3"><Text size="xsmall" className="text-ui-fg-muted">Last good database backup</Text><Text weight="plus">{when(lastOk?.finished_at ?? null)}</Text><Text size="xsmall" className="text-ui-fg-subtle">{lastOk ? `${size(lastOk.bytes)}, ${lastOk.tables} tables` : ""}</Text></div>
        <div className="rounded-lg border border-ui-border-base p-3"><Text size="xsmall" className="text-ui-fg-muted">Last collected by Google Drive</Text><Text weight="plus">{when(lastPulled)}</Text></div>
        <div className="rounded-lg border border-ui-border-base p-3"><Text size="xsmall" className="text-ui-fg-muted">Next scheduled backup</Text><Text weight="plus">{s.enabled ? "At 7 minutes past every hour" : "Off"}</Text></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button isLoading={busy === "run"} disabled={Boolean(busy) || !s.recipient} onClick={() => act("run", { action: "run_now" }, (d) => {
          if (d.result?.status === "done") toast.success("Backup made and checked")
          else toast.error(d.result?.reason || "The backup failed; see the history below.")
        })}>Back up now</Button>
      </div>
      {!state.email_configured ? <Alert variant="warning">Alert emails cannot be sent: EMAILIT_API_KEY and EMAIL_FROM are not set on the server.</Alert> : null}
    </Container>

    <Container className="space-y-3">
      <Heading level="h2">1. Encryption key</Heading>
      <Text size="small" className="max-w-3xl text-ui-fg-subtle">
        The key is made here in your browser. The PRIVATE key downloads as a file; save it on a USB stick and print it. The server only gets the public key,
        which can lock files but never open them. If the private key is lost, the backups cannot be opened by anyone.
      </Text>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={createKey} disabled={Boolean(busy)}>{s.recipient ? "Make a new key" : "Create encryption key"}</Button>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="backup-recipient" size="small">Public key (age1...)</Label>
        <Input id="backup-recipient" value={recipient} placeholder="age1..." spellCheck={false} onChange={(e) => { setRecipient(e.target.value); setNewKey(false) }} />
      </div>
      {newKey ? <div className="flex items-start gap-2">
        <Checkbox id="backup-key-saved" checked={keySaved} onCheckedChange={(v) => setKeySaved(v === true)} />
        <Label htmlFor="backup-key-saved" size="small">I saved the private key file on a USB stick and printed it.</Label>
      </div> : null}
      <Button disabled={Boolean(busy) || !keyDirty || (newKey && !keySaved)} isLoading={busy === "key"}
        onClick={() => act("key", { action: "save", recipient }, () => { setNewKey(false); toast.success("Encryption key saved") })}>Save key</Button>
    </Container>

    <Container className="space-y-3">
      <Heading level="h2">2. Turn on</Heading>
      <div className="flex items-center gap-3">
        <Switch id="backup-enabled" checked={s.enabled} disabled={Boolean(busy) || !s.recipient}
          onCheckedChange={(on) => act("enabled", { action: "save", enabled: on })} />
        <Label htmlFor="backup-enabled">Hourly backups</Label>
      </div>
      <div className="grid max-w-xl gap-1">
        <Label htmlFor="backup-email" size="small">Alert email (empty: the Tracking alert email)</Label>
        <div className="flex gap-2">
          <Input id="backup-email" type="email" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} />
          <Button variant="secondary" disabled={Boolean(busy) || alertEmail === (s.alert_email ?? "")} onClick={() => act("email", { action: "save", alert_email: alertEmail }, () => toast.success("Saved"))}>Save</Button>
        </div>
        <Text size="xsmall" className="text-ui-fg-muted">Emails when a backup fails, when it works again, and when Google Drive has not collected anything for 4 hours.</Text>
      </div>
    </Container>

    <Container className="space-y-3">
      <Heading level="h2">3. Google Drive</Heading>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ui-fg-subtle">
        <li>Open <a className="text-ui-fg-interactive underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a> with the Google account that has your 1 TB storage, and make a new project named "Florayn backups".</li>
        <li>Delete what is in the editor, paste the script below, and save.</li>
        <li>Press "Create Drive token" here and copy it. In the script: Project Settings (gear) &gt; Script Properties &gt; add <code>FLORAYN_BACKUP_TOKEN</code> with the token as its value.</li>
        <li>Back in the editor choose the function <code>setup</code> and press Run, then allow the access Google asks for. The folder "Florayn Backups" appears in Drive within a minute.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" isLoading={busy === "token"} disabled={Boolean(busy)} onClick={() => {
          if (s.token_set && !window.confirm("Make a new token? The script stops working until you paste the new token into its Script Properties.")) return
          void act("token", { action: "rotate_token" }, (d) => setToken(d.token ?? ""))
        }}>{s.token_set ? "Replace Drive token" : "Create Drive token"}</Button>
        <Text size="small" className="text-ui-fg-subtle">{s.token_set ? `A token ending in ${s.pull_token_hint} is set.` : "No token yet."}</Text>
      </div>
      {token ? <Alert variant="warning"><div className="space-y-2">
        <Text size="small" weight="plus">Copy this token now; it is not shown again. Do not send it in chat or email.</Text>
        <div className="flex gap-2"><Input readOnly value={token} onFocus={(e) => e.currentTarget.select()} /><Button variant="secondary" onClick={() => navigator.clipboard.writeText(token).then(() => toast.success("Token copied"))}>Copy</Button></div>
      </div></Alert> : null}
      <div className="grid gap-1">
        <div className="flex items-center justify-between"><Label size="small">Apps Script (calls {state.pull_url})</Label><Button size="small" variant="secondary" onClick={() => navigator.clipboard.writeText(state.script).then(() => toast.success("Script copied"))}>Copy script</Button></div>
        <Textarea readOnly rows={10} value={state.script} className="font-mono text-xs" />
      </div>
    </Container>

    <Container className="space-y-3">
      <Heading level="h2">Files on the server</Heading>
      <Text size="small" className="text-ui-fg-subtle">The newest {s.keep_local} of each kind stay here; Google Drive keeps the history. Download one each month to a USB stick for a copy outside Google too.</Text>
      {state.files.length ? <ul className="divide-y divide-ui-border-base rounded-lg border border-ui-border-base">
        {state.files.map((f) => <li key={f.name} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
          <span className="font-mono text-xs">{f.name}</span>
          <span className="flex items-center gap-3"><span className="text-ui-fg-subtle">{size(f.bytes)}</span><a className="text-ui-fg-interactive underline" href={`/admin/backups/download?name=${encodeURIComponent(f.name)}`}>Download</a></span>
        </li>)}
      </ul> : <Text size="small">No files yet.</Text>}
    </Container>

    <Container className="space-y-3">
      <Heading level="h2">History</Heading>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ui-fg-muted"><tr><th className="py-1 pr-3">Time</th><th className="pr-3">What</th><th className="pr-3">Size</th><th className="pr-3">Result</th><th>In Google Drive</th></tr></thead>
          <tbody>{state.runs.slice(0, 40).map((r) => <tr key={r.id} className="border-t border-ui-border-base align-top">
            <td className="py-1 pr-3 whitespace-nowrap">{when(r.started_at)}</td>
            <td className="pr-3">{r.kind === "db" ? `Database${r.tables ? ` (${r.tables} tables)` : ""}` : "Settings"}{r.trigger === "manual" ? " · manual" : ""}</td>
            <td className="pr-3">{size(r.bytes)}</td>
            <td className="pr-3">{r.ok ? <Badge color="green">OK</Badge> : <span className="text-ui-fg-error">{r.error ?? "failed"}</span>}</td>
            <td>{r.pulled_at ? when(r.pulled_at) : r.ok ? "waiting" : ""}</td>
          </tr>)}</tbody>
        </table>
        {!state.runs.length ? <Text size="small">No backups yet.</Text> : null}
      </div>
    </Container>
  </div>
}

export default BackupsPage

export const config = defineRouteConfig({ label: "Backups", icon: CloudArrowUp })
