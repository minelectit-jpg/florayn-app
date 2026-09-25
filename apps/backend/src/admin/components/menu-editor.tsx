import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useId, useState } from "react"

import { ImageField } from "./content-editors"
import {
  linkBody,
  linkFields,
  sameLink,
  sameSectionDraft,
  settleDraft,
  type LinkDraft,
} from "./navigation/drafts"
import {
  FAMILY_NAMES,
  FORM_OPTIONS,
  KIND_OPTIONS,
  PLACEMENT_OPTIONS,
  guessFamilies,
  readConfig,
  sectionKind,
  sectionPayload,
  sectionPlacement,
  type AdminMenuSection,
  type MenuKind,
  type MenuPlacement,
  type SectionDraft,
} from "./navigation/section-input"
import {
  CaseStylesSettings,
  CollectionsRowSettings,
  DeviceModelsSettings,
  useNavigationCatalog,
} from "./navigation/section-settings"
import { ManagerSelect, useUnsaved } from "./product-manager/shared"

export type MenuSection = AdminMenuSection

export type MenuItem = {
  id: string
  section_id: string
  group: string | null
  label: string
  href: string
  badge: string | null
  position: number
  is_visible: boolean
}

export async function contentApi(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`)
  return body
}

/** What a section looks like before any edit. */
function fromSection(section: MenuSection): SectionDraft {
  return {
    label: section.label,
    href: section.href,
    image_url: section.image_url ?? null,
    badge: section.badge ?? null,
    kind: sectionKind(section),
    placement: sectionPlacement(section),
    config: section.config ?? null,
  }
}

function without<T>(all: Record<string, T>, key: string): Record<string, T> {
  const next = { ...all }
  delete next[key]
  return next
}

/** One line under a section's name: what it is and where it shows. */
function summary(draft: SectionDraft, linkCount: number) {
  const where = PLACEMENT_OPTIONS.find((p) => p.value === draft.placement)?.label ?? ""
  let what = `${linkCount} ${linkCount === 1 ? "link" : "links"}`
  if (draft.kind === "devices") {
    const families = readConfig("devices", draft.config, []).families
    what = `Device models: ${families.map((f) => FAMILY_NAMES[f]).join(", ") || "no brand"}`
  } else if (draft.kind === "case_types") {
    const form = readConfig("case_types", draft.config).form
    what = `Case styles: ${FORM_OPTIONS.find((f) => f.value === form)?.label ?? form}`
  } else if (draft.kind === "collections") {
    what = "Collections row"
  }
  return `${what} · ${where}`
}

/**
 * Edits one menu - the header navigation or the footer. Both are the same
 * shape: ordered sections, each holding ordered links, with an optional group
 * heading that turns a flat list into a mega-menu column.
 *
 * `typed` (the header menus) adds each section's type, placement, picture
 * and badge: a Links section keeps the links editor, while Device models,
 * Case styles and the Collections row fill themselves on the store.
 */
export default function MenuEditor({
  menu,
  title,
  description,
  /** Show the group-heading field; the footer has no groups. */
  useGroups,
  typed = false,
  onDirtyChange,
}: {
  menu: "primary" | "primary-men" | "footer"
  title: string
  description: string
  useGroups: boolean
  typed?: boolean
  /** Told whenever unsaved section or link edits appear or go. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [sections, setSections] = useState<MenuSection[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  // Unsaved edits, by section id and by link id. Every write reloads
  // `sections` and `items` from the server, so the edits live beside them:
  // moving, hiding or saving anything else never throws them away.
  const [drafts, setDrafts] = useState<Record<string, SectionDraft>>({})
  const [linkDrafts, setLinkDrafts] = useState<Record<string, LinkDraft>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [legacyOpen, setLegacyOpen] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const { catalog, error: catalogError } = useNavigationCatalog(typed)
  const uid = useId()

  function apply(data: any) {
    setSections(data.menuSections ?? [])
    setItems(data.items ?? [])
  }

  function load() {
    setLoading(true)
    contentApi("/admin/content")
      .then(apply)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const mine = sections
    .filter((s) => s.menu === menu)
    .sort((a, b) => a.position - b.position)

  const linksOf = (sectionId: string) =>
    items
      .filter((i) => i.section_id === sectionId)
      .sort((a, b) => a.position - b.position)

  const draftOf = (section: MenuSection) => drafts[section.id] ?? fromSection(section)
  // By value: the saved config comes back from Postgres with its keys reordered.
  const isDirty = (section: MenuSection) =>
    !!drafts[section.id] && !sameSectionDraft(drafts[section.id], fromSection(section))
  const linkDraftOf = (item: MenuItem) => linkDrafts[item.id] ?? linkFields(item)
  const isLinkDirty = (item: MenuItem) =>
    !!linkDrafts[item.id] && !sameLink(linkDrafts[item.id], linkFields(item))
  const dirtyLinks = (sectionId: string) => linksOf(sectionId).filter(isLinkDirty)
  /** Anything unsaved in the section's card: its own fields or one of its links. */
  const cardDirty = (section: MenuSection) => isDirty(section) || dirtyLinks(section.id).length > 0
  const anyDirty = mine.some(cardDirty)
  useUnsaved(anyDirty)
  useEffect(() => { onDirtyChange?.(anyDirty) }, [anyDirty])

  function edit(section: MenuSection, patch: Partial<SectionDraft>) {
    setDrafts((all) => ({ ...all, [section.id]: { ...(all[section.id] ?? fromSection(section)), ...patch } }))
  }

  function editLink(item: MenuItem, patch: Partial<LinkDraft>) {
    setLinkDrafts((all) => ({ ...all, [item.id]: { ...(all[item.id] ?? linkFields(item)), ...patch } }))
  }

  /** Drops the section's unsaved edits, its links' included. */
  function forget(sectionId: string) {
    const links = new Set(items.filter((i) => i.section_id === sectionId).map((i) => i.id))
    setDrafts((all) => without(all, sectionId))
    setLinkDrafts((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !links.has(id))))
    setErrors((all) => without(all, sectionId))
  }

  /** Runs a write and shows its result; the response body, or null after an error. */
  async function call(path: string, body?: unknown, method = "POST", sectionId?: string) {
    try {
      const data = await contentApi(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      apply(data)
      return data
    } catch (e: any) {
      if (sectionId) setErrors((all) => ({ ...all, [sectionId]: e.message }))
      toast.error(e.message)
      return null
    }
  }

  async function moveSection(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= mine.length) return
    const a = mine[index]
    const b = mine[next]
    await call(`/admin/content/menu-sections/${a.id}`, { position: b.position })
    await call(`/admin/content/menu-sections/${b.id}`, { position: a.position })
  }

  async function moveItem(sectionId: string, index: number, delta: number) {
    const list = linksOf(sectionId)
    const next = index + delta
    if (next < 0 || next >= list.length) return
    const a = list[index]
    const b = list[next]
    await call(`/admin/content/menu-items/${a.id}`, { position: b.position })
    await call(`/admin/content/menu-items/${b.id}`, { position: a.position })
  }

  /** Saves one link's edits; true when it saved. */
  async function saveLink(item: MenuItem): Promise<boolean> {
    const sent = linkDraftOf(item)
    const data = await call(`/admin/content/menu-items/${item.id}`, linkBody(sent))
    if (!data) return false
    // Anything typed while the save ran stays, unsaved.
    setLinkDrafts((all) => settleDraft(all, item.id, sent, sameLink))
    return true
  }

  /** Saves everything unsaved in the section's card: its own fields, then its links. */
  async function saveSection(section: MenuSection) {
    const draft = draftOf(section)
    const links = dirtyLinks(section.id)
    // Its own fields when they changed, or when nothing did (the footer's plain Save).
    const saveOwn = isDirty(section) || !links.length
    let body: unknown
    if (saveOwn) {
      try {
        body = typed
          ? sectionPayload(draft, catalog?.caseTypes ?? null, catalog?.allCaseTypes ?? null)
          : { label: draft.label, href: draft.href ?? "" }
      } catch (e: any) {
        setErrors((all) => ({ ...all, [section.id]: e.message }))
        toast.error(e.message)
        return
      }
    }
    setSavingId(section.id)
    try {
      if (saveOwn) {
        const data = await call(`/admin/content/menu-sections/${section.id}`, body, "POST", section.id)
        if (!data) return
        // A backend without the new columns answers without them: keep the edit and say so.
        const saved = (data.menuSections ?? []).find((s: MenuSection) => s.id === section.id)
        if (typed && saved && !("kind" in saved)) {
          const message = "The server did not save the type, picture or badge. Update the backend, then try again."
          setErrors((all) => ({ ...all, [section.id]: message }))
          toast.error(message)
          return
        }
        // Anything typed while the save ran stays, unsaved.
        setDrafts((all) => settleDraft(all, section.id, draft, sameSectionDraft))
        setErrors((all) => without(all, section.id))
      }
      let linksSaved = true
      for (const item of links) linksSaved = (await saveLink(item)) && linksSaved
      if (linksSaved) toast.success("Saved")
    } finally {
      setSavingId(null)
    }
  }

  async function addSection() {
    const before = new Set(sections.map((s) => s.id))
    const data = await call("/admin/content/menu-sections", {
      menu,
      label: menu === "footer" ? "New column" : "New menu",
    })
    if (!data) return
    toast.success("Added")
    // Open a new header section straight away: its type comes next.
    const created = (data.menuSections ?? []).find((s: MenuSection) => s.menu === menu && !before.has(s.id))
    if (typed && created) setOpenId(created.id)
  }

  function removeSection(section: MenuSection, linkCount: number) {
    if (!confirm(`Delete "${section.label}" and its ${linkCount} links?`)) return
    forget(section.id)
    call(`/admin/content/menu-sections/${section.id}`, undefined, "DELETE")
  }

  /** A new type starts from its saved settings, or from defaults read off the section. */
  function changeKind(section: MenuSection, kind: MenuKind) {
    const draft = draftOf(section)
    const guess = guessFamilies(
      [draft.label, draft.href ?? "", ...linksOf(section.id).map((l) => `${l.label} ${l.href}`)].join(" ")
    )
    const config = kind === sectionKind(section) ? section.config ?? null : readConfig(kind, null, guess)
    edit(section, { kind, config })
  }

  // A plain function, not a component, so typing keeps focus between renders.
  function linksEditor(sectionId: string) {
    const links = linksOf(sectionId)
    return (
      <div>
        <div className="flex flex-col gap-y-2">
          {links.map((item, i) => {
            const link = linkDraftOf(item)
            const dirty = isLinkDirty(item)
            return (
              <div key={item.id} className="flex flex-wrap items-center gap-2">
                <div className="flex gap-x-1">
                  <Button
                    size="small"
                    variant="transparent"
                    disabled={i === 0}
                    onClick={() => moveItem(sectionId, i, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    size="small"
                    variant="transparent"
                    disabled={i === links.length - 1}
                    onClick={() => moveItem(sectionId, i, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                </div>
                {useGroups ? (
                  <Input
                    className="w-44"
                    placeholder="Group heading"
                    aria-label="Group heading"
                    value={link.group ?? ""}
                    onChange={(e) => editLink(item, { group: e.target.value })}
                  />
                ) : null}
                <Input
                  className="w-52"
                  aria-label="Link label"
                  value={link.label}
                  onChange={(e) => editLink(item, { label: e.target.value })}
                />
                <Input
                  className="w-96"
                  aria-label="Link"
                  value={link.href}
                  onChange={(e) => editLink(item, { href: e.target.value })}
                />
                <Input
                  className="w-24"
                  placeholder="Badge"
                  aria-label="Link badge"
                  value={link.badge ?? ""}
                  onChange={(e) => editLink(item, { badge: e.target.value })}
                />
                <Switch
                  checked={item.is_visible}
                  onCheckedChange={(v) =>
                    call(`/admin/content/menu-items/${item.id}`, {
                      is_visible: v,
                    })
                  }
                />
                <Button
                  size="small"
                  variant={dirty ? "primary" : "secondary"}
                  onClick={() => saveLink(item).then((ok) => ok && toast.success("Saved"))}
                >
                  Save
                </Button>
                <Button
                  size="small"
                  variant="danger"
                  onClick={() =>
                    call(
                      `/admin/content/menu-items/${item.id}`,
                      undefined,
                      "DELETE"
                    ).then((data) => data && setLinkDrafts((all) => without(all, item.id)))
                  }
                >
                  ✕
                </Button>
                {dirty ? <Text size="xsmall" className="text-ui-fg-subtle">Unsaved</Text> : null}
              </div>
            )
          })}
        </div>

        <Button
          className="mt-3"
          size="small"
          variant="secondary"
          onClick={() =>
            call("/admin/content/menu-items", {
              section_id: sectionId,
              label: "New link",
              href: "/",
            })
          }
        >
          Add link
        </Button>
      </div>
    )
  }

  /** The type's own settings: the links editor, or what an automatic section needs. */
  function typeSettings(section: MenuSection, draft: SectionDraft) {
    if (draft.kind === "links") return linksEditor(section.id)
    const set = (config: unknown) => edit(section, { config })
    if (draft.kind === "devices") {
      return <DeviceModelsSettings config={readConfig("devices", draft.config, [])} onChange={set} catalog={catalog} catalogError={catalogError} />
    }
    if (draft.kind === "case_types") {
      return <CaseStylesSettings config={readConfig("case_types", draft.config)} onChange={set} catalog={catalog} catalogError={catalogError} />
    }
    return <CollectionsRowSettings config={readConfig("collections", draft.config)} onChange={set} />
  }

  /** Links saved under a section that has become automatic: kept, not shown. */
  function legacyLinks(section: MenuSection) {
    const links = linksOf(section.id)
    if (!links.length) return null
    const open = legacyOpen === section.id
    return (
      <div className="grid gap-2">
        <div>
          <Button size="small" variant="transparent" aria-expanded={open} onClick={() => setLegacyOpen(open ? null : section.id)}>
            {open ? "▾" : "▸"} {links.length} old {links.length === 1 ? "link" : "links"} (kept, not shown on the store)
          </Button>
        </div>
        {open ? (
          <ul className="grid gap-1 pl-6">
            {links.map((l) => (
              <li key={l.id}>
                <Text size="small" className="text-ui-fg-subtle">
                  {l.group ? `${l.group} / ` : ""}{l.label} - {l.href}
                </Text>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  function typedCard(section: MenuSection, index: number) {
    const draft = draftOf(section)
    const links = linksOf(section.id)
    const isOpen = openId === section.id
    const dirty = cardDirty(section)
    const error = errors[section.id]
    const field = `${uid}-${section.id}`
    return (
      <Container key={section.id} className="divide-y p-0">
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="flex gap-x-1">
            <Button size="small" variant="transparent" disabled={index === 0} onClick={() => moveSection(index, -1)} aria-label="Move up">↑</Button>
            <Button size="small" variant="transparent" disabled={index === mine.length - 1} onClick={() => moveSection(index, 1)} aria-label="Move down">↓</Button>
          </div>
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-ui-border-base bg-ui-bg-subtle">
            {draft.image_url ? <img src={draft.image_url} alt="" className="h-full w-full object-cover" /> : null}
          </span>
          <div className="min-w-48 flex-1">
            <div className="flex items-center gap-2">
              <Text size="small" weight="plus">{draft.label || "Untitled"}</Text>
              {draft.badge ? <Badge size="2xsmall" color="green">{draft.badge}</Badge> : null}
              {dirty ? <Badge size="2xsmall" color="orange">Unsaved</Badge> : null}
            </div>
            <Text size="xsmall" className="text-ui-fg-subtle">{summary(draft, links.length)}</Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Label size="small" htmlFor={`${field}-shown`}>Shown</Label>
            <Switch
              id={`${field}-shown`}
              checked={section.is_visible}
              onCheckedChange={(v) => call(`/admin/content/menu-sections/${section.id}`, { is_visible: v })}
            />
          </div>
          <div className="flex gap-x-2">
            <Button size="small" variant={isOpen ? "primary" : "secondary"} aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : section.id)}>
              {isOpen ? "Close" : "Edit"}
            </Button>
            <Button size="small" variant="danger" onClick={() => removeSection(section, links.length)}>Delete</Button>
          </div>
        </div>

        {isOpen ? (
          <div className="flex flex-col gap-y-6 px-6 py-5">
            {error ? (
              <div role="alert" className="rounded-lg border border-ui-border-error p-3 text-ui-fg-error">
                <Text size="small">{error}</Text>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid content-start gap-2">
                <Label size="small" htmlFor={`${field}-label`}>Label</Label>
                <Input id={`${field}-label`} value={draft.label} onChange={(e) => edit(section, { label: e.target.value })} />
              </div>
              <div className="grid content-start gap-2">
                <Label size="small" htmlFor={`${field}-href`}>Link</Label>
                <Input id={`${field}-href`} placeholder="/shop/" value={draft.href ?? ""} onChange={(e) => edit(section, { href: e.target.value || null })} />
                <Text size="xsmall" className="text-ui-fg-subtle">Where the label goes. Device and link sections also show it as Shop all.</Text>
              </div>
              <div className="grid content-start gap-2">
                <Label size="small" htmlFor={`${field}-kind`}>Type</Label>
                <ManagerSelect id={`${field}-kind`} value={draft.kind} onValueChange={(kind) => changeKind(section, kind as MenuKind)}>
                  {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </ManagerSelect>
              </div>
              <div className="grid content-start gap-2">
                <Label size="small" htmlFor={`${field}-placement`}>Shows in</Label>
                <ManagerSelect id={`${field}-placement`} value={draft.placement} onValueChange={(placement) => edit(section, { placement: placement as MenuPlacement })}>
                  {PLACEMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </ManagerSelect>
              </div>
              <ImageField
                label="Image"
                value={draft.image_url}
                onChange={(image_url) => edit(section, { image_url })}
                hint="Round picture in the phone menu and the desktop panel. Square, 320 x 320 webp."
                square
              />
              <div className="grid content-start gap-2">
                <Label size="small" htmlFor={`${field}-badge`}>Badge</Label>
                <Input id={`${field}-badge`} className="md:max-w-[160px]" maxLength={12} placeholder="e.g. New" value={draft.badge ?? ""} onChange={(e) => edit(section, { badge: e.target.value || null })} />
              </div>
            </div>

            <div className="grid gap-4 border-t border-ui-border-base pt-5">
              <Heading level="h3">{KIND_OPTIONS.find((o) => o.value === draft.kind)?.label}</Heading>
              {typeSettings(section, draft)}
              {draft.kind !== "links" ? legacyLinks(section) : null}
            </div>

            <div className="flex items-center justify-end gap-x-2">
              {dirty ? <Text size="xsmall" className="mr-auto text-ui-fg-subtle">Unsaved changes</Text> : null}
              <Button size="small" variant="secondary" disabled={!dirty || savingId === section.id} onClick={() => forget(section.id)}>Discard</Button>
              <Button size="small" disabled={!dirty} isLoading={savingId === section.id} onClick={() => saveSection(section)}>Save changes</Button>
            </div>
          </div>
        ) : null}
      </Container>
    )
  }

  function plainRow(section: MenuSection, index: number) {
    const draft = draftOf(section)
    const links = linksOf(section.id)
    const isOpen = openId === section.id
    return (
      <Container key={section.id} className="divide-y p-0">
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="flex gap-x-1">
            <Button
              size="small"
              variant="transparent"
              disabled={index === 0}
              onClick={() => moveSection(index, -1)}
              aria-label="Move up"
            >
              ↑
            </Button>
            <Button
              size="small"
              variant="transparent"
              disabled={index === mine.length - 1}
              onClick={() => moveSection(index, 1)}
              aria-label="Move down"
            >
              ↓
            </Button>
          </div>

          <Input
            className="w-52"
            value={draft.label}
            onChange={(e) => edit(section, { label: e.target.value })}
          />
          <Input
            className="w-80"
            placeholder="Link (blank = dropdown only)"
            value={draft.href ?? ""}
            onChange={(e) => edit(section, { href: e.target.value || null })}
          />

          <div className="flex items-center gap-x-2">
            <Label size="small">Shown</Label>
            <Switch
              checked={section.is_visible}
              onCheckedChange={(v) =>
                call(`/admin/content/menu-sections/${section.id}`, {
                  is_visible: v,
                })
              }
            />
          </div>

          <div className="ml-auto flex gap-x-2">
            <Button
              size="small"
              variant={cardDirty(section) ? "primary" : "secondary"}
              isLoading={savingId === section.id}
              onClick={() => saveSection(section)}
            >
              Save
            </Button>
            <Button
              size="small"
              variant="transparent"
              onClick={() => setOpenId(isOpen ? null : section.id)}
            >
              {isOpen ? "Hide" : `${links.length} links`}
            </Button>
            <Button
              size="small"
              variant="danger"
              onClick={() => removeSection(section, links.length)}
            >
              Delete
            </Button>
          </div>
        </div>

        {isOpen ? <div className="px-6 py-4">{linksEditor(section.id)}</div> : null}
      </Container>
    )
  }

  if (loading) {
    return (
      <Container>
        <Text>Loading {title.toLowerCase()}...</Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div>
            <Heading level="h1">{title}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {description}
            </Text>
          </div>
          <Button variant="secondary" onClick={addSection}>
            {menu === "footer" ? "Add column" : "Add menu"}
          </Button>
        </div>
      </Container>

      {mine.map((section, index) =>
        typed ? typedCard(section, index) : plainRow(section, index)
      )}
    </div>
  )
}
