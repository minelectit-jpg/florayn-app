import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Envelope } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Label, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"

type Faq = { id: string; question: string; answer: string }
type Settings = {
  eyebrow: string; title: string; description: string
  phone_label: string; phone: string; phone_note: string
  email_label: string; email: string; email_note: string
  address_label: string; address: string; address_note: string
  faq_eyebrow: string; faq_title: string; faq_description: string
  help_title: string; help_description: string; faqs: Faq[]
}
type TextKey = Exclude<keyof Settings, "faqs">
type Field = { key: TextKey; label: string; limit: number; required?: boolean; rows?: number; type?: "tel" | "email"; hint?: string }
const groups: { title: string; description: string; fields: Field[] }[] = [
  { title: "Page introduction", description: "Set the first message customers see on your Contact page.", fields: [
    { key: "eyebrow", label: "Small heading", limit: 60 },
    { key: "title", label: "Page title", limit: 120, required: true },
    { key: "description", label: "Introduction", limit: 600, rows: 3 },
  ] },
  { title: "Phone", description: "The number customers can tap to call you. Leave the number blank to hide this contact method.", fields: [
    { key: "phone_label", label: "Phone heading", limit: 60, required: true },
    { key: "phone", label: "Phone number", limit: 40, type: "tel", hint: "Use an international number, such as +8801310007055. Local Bangladesh numbers are also accepted." },
    { key: "phone_note", label: "Phone note", limit: 240, rows: 2, hint: "For example, add your actual phone support hours. Optional." },
  ] },
  { title: "Email", description: "The address customers can use to email you. Leave it blank to hide this contact method.", fields: [
    { key: "email_label", label: "Email heading", limit: 60, required: true },
    { key: "email", label: "Email address", limit: 254, type: "email" },
    { key: "email_note", label: "Email note", limit: 240, rows: 2, hint: "Add a response estimate only if your team can meet it. Optional." },
  ] },
  { title: "Address", description: "Show your public business address. Leave it blank to hide this contact method.", fields: [
    { key: "address_label", label: "Address heading", limit: 60, required: true },
    { key: "address", label: "Business address", limit: 1000, rows: 4 },
    { key: "address_note", label: "Address note", limit: 240, rows: 2, hint: "Clarify visitor or appointment arrangements if relevant. Optional." },
  ] },
  { title: "FAQ introduction", description: "Introduce the questions below. Customers will see FAQs in the order you choose.", fields: [
    { key: "faq_eyebrow", label: "Small FAQ heading", limit: 60 },
    { key: "faq_title", label: "FAQ section title", limit: 120, required: true },
    { key: "faq_description", label: "FAQ introduction", limit: 600, rows: 3 },
  ] },
  { title: "Closing message", description: "A final invitation to get in touch using the contact details above.", fields: [
    { key: "help_title", label: "Closing heading", limit: 120 },
    { key: "help_description", label: "Closing description", limit: 600, rows: 3 },
  ] },
]
const textFields = groups.flatMap((group) => group.fields)

function readSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The server returned incomplete contact settings.")
  const source = value as Record<string, unknown>
  const settings = {} as Settings
  for (const { key } of textFields) {
    if (typeof source[key] !== "string") throw new Error("The server returned incomplete contact settings.")
    settings[key] = source[key] as string
  }
  if (!Array.isArray(source.faqs) || source.faqs.length > 30 || source.faqs.some((faq) =>
    !faq || typeof faq !== "object" || [faq.id, faq.question, faq.answer].some((value) => typeof value !== "string"))) {
    throw new Error("The server returned incomplete frequently asked questions.")
  }
  settings.faqs = source.faqs.map((faq) => ({ id: faq.id, question: faq.question, answer: faq.answer }))
  return settings
}

function validate(settings: Settings) {
  const errors: Record<string, string> = {}
  for (const field of textFields) {
    if (field.required && !settings[field.key].trim()) errors[field.key] = `${field.label} is required.`
    else if (settings[field.key].length > field.limit) errors[field.key] = `Keep ${field.label.toLowerCase()} within ${field.limit} characters.`
  }
  if (settings.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.email.trim())) errors.email = "Enter a valid email address, or leave it blank."
  if (settings.faqs.length > 30) errors.faqs = "You can add up to 30 questions."
  settings.faqs.forEach((faq, index) => {
    if (!faq.question.trim()) errors[`faqs.${index}.question`] = "Enter a question, or remove this FAQ."
    else if (faq.question.length > 200) errors[`faqs.${index}.question`] = "Keep the question within 200 characters."
    if (!faq.answer.trim()) errors[`faqs.${index}.answer`] = "Enter an answer, or remove this FAQ."
    else if (faq.answer.length > 2000) errors[`faqs.${index}.answer`] = "Keep the answer within 2,000 characters."
  })
  return errors
}

function responseErrors(data: unknown): Record<string, string> {
  const source = data as { message?: unknown; errors?: unknown } | null
  if (source?.errors && typeof source.errors === "object" && !Array.isArray(source.errors)) {
    const errors = Object.fromEntries(Object.entries(source.errors).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1])))
    if (Object.keys(errors).length) return errors
  }
  return { form: typeof source?.message === "string" ? source.message : "Could not save contact settings. Your edits are still here; please try again." }
}

const ContactPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [savedValue, setSavedValue] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState("")
  const [reload, setReload] = useState(0)
  const [saved, setSaved] = useState(false)
  const dirty = settings !== null && JSON.stringify(settings) !== savedValue

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError("")
    fetch("/admin/contact-settings", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load Contact settings.")
        const data = await response.json()
        const next = readSettings(data.settings)
        if (controller.signal.aborted) return
        setSettings(next)
        setSavedValue(JSON.stringify(next))
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setLoadError(error.message || "Could not load Contact settings.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function clearErrors(key: string) {
    setSaved(false)
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([name]) =>
      name !== "form" && name !== key && !(key === "faqs" && name.startsWith("faqs.")))))
  }
  function update(key: TextKey, value: string) {
    setSettings((current) => current ? { ...current, [key]: value } : current)
    clearErrors(key)
  }
  function updateFaqs(change: (faqs: Faq[]) => Faq[]) {
    setSettings((current) => current ? { ...current, faqs: change(current.faqs) } : current)
    clearErrors("faqs")
  }
  function addFaq() {
    const id = `faq_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
    updateFaqs((faqs) => faqs.length >= 30 ? faqs : [...faqs, {
      id, question: "", answer: "",
    }])
    requestAnimationFrame(() => {
      const field = formRef.current?.querySelector<HTMLElement>(`#contact-${id}-question`)
      field?.focus()
      field?.scrollIntoView({ block: "center" })
    })
  }
  function moveFaq(index: number, direction: -1 | 1) {
    updateFaqs((faqs) => {
      const target = index + direction
      if (target < 0 || target >= faqs.length) return faqs
      const next = [...faqs]
      const moved = next[index]
      next[index] = next[target]
      next[target] = moved
      return next
    })
  }
  function focusError(next: Record<string, string>) {
    const key = Object.keys(next)[0]
    requestAnimationFrame(() => {
      const fields = formRef.current?.querySelectorAll<HTMLElement>("[data-contact-field]")
      const field = fields ? Array.from(fields).find((element) => element.dataset.contactField === key) : undefined
      const target = field ?? formRef.current?.querySelector<HTMLElement>("[data-contact-errors]")
      target?.focus()
      target?.scrollIntoView({ block: "center" })
    })
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!settings || loading || savingRef.current || !dirty) return
    const invalid = validate(settings)
    if (Object.keys(invalid).length) { setErrors(invalid); focusError(invalid); return }
    savingRef.current = true
    setSaving(true)
    setErrors({})
    setSaved(false)
    try {
      const response = await fetch("/admin/contact-settings", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000), body: JSON.stringify(settings),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { const next = responseErrors(data); setErrors(next); focusError(next); return }
      const next = readSettings(data.settings)
      setSettings(next)
      setSavedValue(JSON.stringify(next))
      setSaved(true)
      toast.success("Contact page saved")
    } catch {
      const next = { form: "Could not confirm the save. Your edits are still here; please try again." }
      setErrors(next)
      focusError(next)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) return <Container><Text role="status">Loading Contact settings...</Text></Container>
  if (loadError || !settings) return <Container className="space-y-4">
    <Text role="alert">{loadError || "Could not load Contact settings."}</Text>
    <Button variant="secondary" onClick={() => setReload((value) => value + 1)}>Try again</Button>
  </Container>

  return <form ref={formRef} onSubmit={save} noValidate className="flex flex-col gap-y-4" aria-busy={saving}>
    <Container>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2"><Heading>Contact</Heading><Text size="small" className="max-w-2xl text-ui-fg-subtle">Edit the Contact page on your new storefront. Write plain text; changes appear after you save.</Text></div>
        <a href="https://new.florayn.com/contact/" target="_blank" rel="noopener noreferrer" className="text-sm text-ui-fg-interactive underline underline-offset-4">Preview Contact page</a>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" isLoading={saving} disabled={saving || !dirty}>Save Contact page</Button>
        {dirty ? <Badge color="orange">Unsaved changes</Badge> : <Text size="small" className="text-ui-fg-subtle">Up to date</Text>}
        <Text role="status" size="small">{saved ? "Saved. Open the preview to review your page." : ""}</Text>
      </div>
      {Object.keys(errors).length ? <div data-contact-errors tabIndex={-1} role="alert" className="mt-4 space-y-1 rounded-lg border border-ui-border-error p-3 text-ui-fg-error">
        <Text size="small" weight="plus">Please check before saving</Text>
        <ul className="list-inside list-disc text-sm">{Object.entries(errors).map(([key, message]) => <li key={key}>{message}</li>)}</ul>
      </div> : null}
    </Container>
    <fieldset disabled={saving} className="min-w-0 space-y-4">
      <legend className="sr-only">Contact page content</legend>
      {groups.slice(0, -1).map((group) => <SettingsGroup key={group.title} group={group} settings={settings} errors={errors} update={update} />)}
      <Container>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><Heading level="h2">Frequently asked questions</Heading><Text size="small" className="mt-1 text-ui-fg-subtle">{settings.faqs.length} of 30 questions. Changes to their order are saved with the page.</Text></div><Button type="button" variant="secondary" disabled={settings.faqs.length >= 30 || saving} onClick={addFaq}>Add question</Button></div>
        {settings.faqs.length === 0 ? <div className="rounded-lg border border-dashed border-ui-border-base p-6"><Text size="small" className="text-ui-fg-subtle">No questions yet. Add answers to common questions about your products, orders or delivery.</Text></div> : <div className="space-y-4">{settings.faqs.map((faq, index) => <div key={faq.id} className="space-y-4 rounded-lg border border-ui-border-base p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><Text weight="plus" size="small">Question {index + 1}</Text><div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="small" disabled={index === 0 || saving} aria-label={`Move question ${index + 1} up`} onClick={() => moveFaq(index, -1)}>Move up</Button>
            <Button type="button" variant="secondary" size="small" disabled={index === settings.faqs.length - 1 || saving} aria-label={`Move question ${index + 1} down`} onClick={() => moveFaq(index, 1)}>Move down</Button>
            <Button type="button" variant="danger" size="small" aria-label={`Remove question ${index + 1}`} onClick={() => updateFaqs((faqs) => faqs.filter((item) => item.id !== faq.id))}>Remove</Button>
          </div></div>
          {(["question", "answer"] as const).map((key) => {
            const name = `faqs.${index}.${key}`
            const id = `contact-${faq.id}-${key}`
            const props = { id, "data-contact-field": name, value: faq[key], required: true, maxLength: key === "question" ? 200 : 2000,
              "aria-invalid": Boolean(errors[name]), "aria-describedby": errors[name] ? `${id}-error` : undefined,
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateFaqs((faqs) => faqs.map((item) => item.id === faq.id ? { ...item, [key]: event.target.value } : item)) }
            return <div key={key} className="space-y-2"><Label htmlFor={id}>{key === "question" ? "Question *" : "Answer *"}</Label>{key === "question" ? <Input {...props} /> : <Textarea {...props} rows={4} />}{errors[name] ? <Text id={`${id}-error`} size="small" className="text-ui-fg-error">{errors[name]}</Text> : null}</div>
          })}
          {errors[`faqs.${index}.id`] ? <Text size="small" className="text-ui-fg-error">{errors[`faqs.${index}.id`]}</Text> : null}
        </div>)}</div>}
        <Text size="small" className="mt-4 text-ui-fg-subtle">Questions and answers are plain text. Add only policies and delivery information that match your business.</Text>
      </Container>
      <SettingsGroup group={groups[groups.length - 1]} settings={settings} errors={errors} update={update} />
    </fieldset>
    <Container className="flex flex-wrap items-center justify-between gap-3"><Text size="small" className="text-ui-fg-subtle">Review your changes, then save to update the Contact page.</Text><Button type="submit" isLoading={saving} disabled={saving || !dirty}>Save Contact page</Button></Container>
  </form>
}

function SettingsGroup({ group, settings, errors, update }: {
  group: (typeof groups)[number]
  settings: Settings
  errors: Record<string, string>
  update: (key: TextKey, value: string) => void
}) {
  return <Container>
    <Heading level="h2">{group.title}</Heading><Text size="small" className="mb-5 mt-1 text-ui-fg-subtle">{group.description}</Text>
    <div className="grid gap-5 lg:grid-cols-2">{group.fields.map((field) => {
      const id = `contact-${field.key}`
      const props = { id, name: field.key, "data-contact-field": field.key, value: settings[field.key], maxLength: field.limit,
        required: field.required, "aria-invalid": Boolean(errors[field.key]),
        "aria-describedby": [field.hint ? `${id}-hint` : "", errors[field.key] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(field.key, event.target.value) }
      return <div key={field.key} className={`space-y-2${field.rows ? " lg:col-span-2" : ""}`}>
        <Label htmlFor={id}>{field.label}{field.required ? " *" : " (optional)"}</Label>
        {field.rows ? <Textarea {...props} rows={field.rows} /> : <Input {...props} type={field.type || "text"} />}
        {field.hint ? <Text id={`${id}-hint`} size="small" className="text-ui-fg-subtle">{field.hint}</Text> : null}
        {errors[field.key] ? <Text id={`${id}-error`} size="small" className="text-ui-fg-error">{errors[field.key]}</Text> : null}
      </div>
    })}</div>
  </Container>
}

export const config = defineRouteConfig({ label: "Contact", icon: Envelope })
export default ContactPage
