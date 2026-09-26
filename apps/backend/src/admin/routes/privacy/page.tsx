// Admin > Privacy: the /privacy/ page text, its published switch and Claude's
// suggested draft (TRACKING.md Appendix A), which Florayn must approve.
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShieldCheck } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Label, Switch, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"

type Draft = { title: string; body: string; published: boolean }
type Settings = Draft & { updated_at: string | null }
type Suggested = { title: string; body: string }

const LIMITS = { title: 120, body: 20_000 }
// The same plain-text rule the server applies.
const UNSAFE_TEXT = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/

function readResponse(value: unknown): { settings: Settings; suggested: Suggested } {
  const data = value as { settings?: Record<string, unknown>; suggested?: Record<string, unknown> } | null
  const settings = data?.settings
  const suggested = data?.suggested
  if (!settings || typeof settings.title !== "string" || typeof settings.body !== "string" ||
    typeof settings.published !== "boolean" || (settings.updated_at !== null && typeof settings.updated_at !== "string") ||
    !suggested || typeof suggested.title !== "string" || typeof suggested.body !== "string") {
    throw new Error("The server returned incomplete privacy page settings.")
  }
  return {
    settings: { title: settings.title, body: settings.body, published: settings.published, updated_at: settings.updated_at as string | null },
    suggested: { title: suggested.title, body: suggested.body },
  }
}

const draftOf = ({ title, body, published }: Settings): Draft => ({ title, body, published })

function validate(draft: Draft) {
  const errors: Record<string, string> = {}
  const title = draft.title.trim()
  const body = draft.body.trim()
  if (!title) errors.title = "Enter a page title."
  else if (title.length > LIMITS.title) errors.title = `Keep the title within ${LIMITS.title} characters.`
  else if (UNSAFE_TEXT.test(title)) errors.title = "Use plain text in the title, without < or >."
  if (body.length > LIMITS.body) errors.body = "Keep the text within 20,000 characters."
  else if (UNSAFE_TEXT.test(body)) errors.body = "Use plain text, without < or > signs or HTML."
  if (draft.published && !body) errors.published = "Write the policy before publishing it, or turn off Published."
  return errors
}

function responseErrors(data: unknown): Record<string, string> {
  const source = data as { message?: unknown; errors?: unknown } | null
  if (source?.errors && typeof source.errors === "object" && !Array.isArray(source.errors)) {
    const errors = Object.fromEntries(Object.entries(source.errors).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1])))
    if (Object.keys(errors).length) return errors
  }
  return { form: typeof source?.message === "string" ? source.message : "Could not save the privacy page. Your edits are still here; please try again." }
}

function dhakaTime(value: string | null) {
  if (!value) return "Not saved yet"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown"
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "long", timeStyle: "short" }).format(date) + " (Dhaka)"
}

const PrivacyPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [suggested, setSuggested] = useState<Suggested | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const dirty = settings !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(settings))

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError("")
    fetch("/admin/privacy-settings", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the privacy page.")
        const next = readResponse(await response.json())
        if (controller.signal.aborted) return
        setSettings(next.settings)
        setDraft(draftOf(next.settings))
        setSuggested(next.suggested)
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setLoadError(error.message || "Could not load the privacy page.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function update(change: Partial<Draft>) {
    setDraft((current) => current ? { ...current, ...change } : current)
    setSaved(false)
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) =>
      key !== "form" && !(key in change) && !(key === "published" && "body" in change))))
  }
  function startFromSuggested() {
    if (!draft || !suggested) return
    if (draft.body.trim() && !window.confirm("Replace the current title and text with the suggested draft? Your current text will be lost.")) return
    update({ title: suggested.title, body: suggested.body })
  }
  function setPublished(value: boolean) {
    if (value && !window.confirm("Publish this privacy policy on the website? Only publish wording Florayn has checked and approved.")) return
    update({ published: value })
  }
  function focusError(next: Record<string, string>) {
    const key = Object.keys(next)[0]
    requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>(`[data-privacy-field="${key}"]`) ??
        formRef.current?.querySelector<HTMLElement>("[data-privacy-errors]")
      target?.focus()
      target?.scrollIntoView({ block: "center" })
    })
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!draft || loading || savingRef.current || !dirty) return
    const invalid = validate(draft)
    if (Object.keys(invalid).length) { setErrors(invalid); focusError(invalid); return }
    savingRef.current = true
    setSaving(true)
    setErrors({})
    setSaved(false)
    try {
      const response = await fetch("/admin/privacy-settings", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000), body: JSON.stringify(draft),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { const next = responseErrors(data); setErrors(next); focusError(next); return }
      const next = readResponse(data)
      setSettings(next.settings)
      setDraft(draftOf(next.settings))
      setSaved(true)
      toast.success("Privacy page saved")
    } catch {
      const next = { form: "Could not confirm the save. Your edits are still here; please try again." }
      setErrors(next)
      focusError(next)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) return <Container><Text role="status">Loading the privacy page...</Text></Container>
  if (loadError || !settings || !draft) return <Container className="space-y-4">
    <Text role="alert">{loadError || "Could not load the privacy page."}</Text>
    <Button variant="secondary" onClick={() => setReload((value) => value + 1)}>Try again</Button>
  </Container>

  const fieldProps = (key: "title" | "body") => ({
    id: `privacy-${key}`, name: key, "data-privacy-field": key, value: draft[key], maxLength: LIMITS[key],
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": [`privacy-${key}-hint`, errors[key] ? `privacy-${key}-error` : ""].filter(Boolean).join(" "),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      update(key === "title" ? { title: event.target.value } : { body: event.target.value }),
  })

  return <form ref={formRef} onSubmit={save} noValidate className="flex flex-col gap-y-4" aria-busy={saving}>
    <Container>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><Heading>Privacy</Heading>{settings.published ? <Badge color="green">Published</Badge> : <Badge color="grey">Not published</Badge>}</div>
          <Text size="small" className="max-w-2xl text-ui-fg-subtle">Edit the Privacy policy page on your new storefront. Until it is published, the page shows a short placeholder instead.</Text>
          <Text size="small" weight="plus" className="max-w-2xl">This is a legal document; Florayn must check and approve the wording.</Text>
        </div>
        <a href="https://new.florayn.com/privacy/" target="_blank" rel="noopener noreferrer" className="text-sm text-ui-fg-interactive underline underline-offset-4">Preview Privacy page</a>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" isLoading={saving} disabled={saving || !dirty}>Save Privacy page</Button>
        {dirty ? <Badge color="orange">Unsaved changes</Badge> : <Text size="small" className="text-ui-fg-subtle">Up to date</Text>}
        <Text role="status" size="small">{saved ? "Saved. Open the preview to review your page." : ""}</Text>
      </div>
      <Text size="small" className="mt-3 text-ui-fg-subtle">Last updated: {dhakaTime(settings.updated_at)}</Text>
      {Object.keys(errors).length ? <div data-privacy-errors tabIndex={-1} role="alert" className="mt-4 space-y-1 rounded-lg border border-ui-border-error p-3 text-ui-fg-error">
        <Text size="small" weight="plus">Please check before saving</Text>
        <ul className="list-inside list-disc text-sm">{Object.entries(errors).map(([key, message]) => <li key={key}>{message}</li>)}</ul>
      </div> : null}
    </Container>
    <fieldset disabled={saving} className="min-w-0 space-y-4">
      <legend className="sr-only">Privacy page content</legend>
      <Container className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><Heading level="h2">Suggested draft</Heading><Text size="small" className="mt-1 max-w-2xl text-ui-fg-subtle">A starting point written for Florayn to correct. It is not legal advice, and it is only saved when you save the page.</Text></div>
          <Button type="button" variant="secondary" disabled={!suggested || saving} onClick={startFromSuggested}>Start from the suggested draft</Button>
        </div>
      </Container>
      <Container className="space-y-5">
        <Heading level="h2">Page text</Heading>
        <div className="space-y-2">
          <Label htmlFor="privacy-title">Page title *</Label>
          <Input {...fieldProps("title")} required />
          <Text id="privacy-title-hint" size="small" className="text-ui-fg-subtle">Shown as the page heading, up to {LIMITS.title} characters.</Text>
          {errors.title ? <Text id="privacy-title-error" size="small" className="text-ui-fg-error">{errors.title}</Text> : null}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="privacy-body">Policy text</Label><Text size="small" className="text-ui-fg-subtle">{draft.body.length.toLocaleString("en-US")} / 20,000 characters</Text></div>
          <Textarea {...fieldProps("body")} rows={24} className="font-mono text-sm" />
          <Text id="privacy-body-hint" size="small" className="text-ui-fg-subtle">Plain text. Leave a blank line between paragraphs. Start a line with "## " for a heading and "- " for a list item.</Text>
          {errors.body ? <Text id="privacy-body-error" size="small" className="text-ui-fg-error">{errors.body}</Text> : null}
        </div>
      </Container>
      <Container>
        <div className="flex items-start gap-3">
          <Switch id="privacy-published" data-privacy-field="published" checked={draft.published} onCheckedChange={setPublished}
            aria-invalid={Boolean(errors.published)} aria-describedby="privacy-published-hint" />
          <div className="space-y-1">
            <Label htmlFor="privacy-published">Published</Label>
            <Text id="privacy-published-hint" size="small" className="text-ui-fg-subtle">When on, /privacy/ shows this text with a link that turns off ad measurement on the visitor's browser. Sharing hashed contact details (Admin &gt; Tracking) stays off until this page is published.</Text>
            {errors.published ? <Text role="alert" size="small" className="text-ui-fg-error">{errors.published}</Text> : null}
          </div>
        </div>
      </Container>
    </fieldset>
    <Container className="flex flex-wrap items-center justify-between gap-3"><Text size="small" className="text-ui-fg-subtle">Review your changes, then save to update the Privacy page.</Text><Button type="submit" isLoading={saving} disabled={saving || !dirty}>Save Privacy page</Button></Container>
  </form>
}

export const config = defineRouteConfig({ label: "Privacy", icon: ShieldCheck })
export default PrivacyPage
