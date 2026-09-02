import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

export type MenuSection = {
  id: string
  menu: string
  label: string
  href: string | null
  position: number
  is_visible: boolean
}

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

/**
 * Edits one menu - the header mega menu or the footer. Both are the same
 * shape: ordered sections, each holding ordered links, with an optional group
 * heading that turns a flat list into a mega-menu column.
 */
export default function MenuEditor({
  menu,
  title,
  description,
  /** Show the group-heading field; the footer has no groups. */
  useGroups,
}: {
  menu: "primary" | "footer"
  title: string
  description: string
  useGroups: boolean
}) {
  const [sections, setSections] = useState<MenuSection[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

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

  async function call(path: string, body?: unknown, method = "POST") {
    try {
      apply(
        await contentApi(path, {
          method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      )
      return true
    } catch (e: any) {
      toast.error(e.message)
      return false
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
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">{title}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {description}
            </Text>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              call("/admin/content/menu-sections", {
                menu,
                label: menu === "footer" ? "New column" : "New menu",
              }).then((ok) => ok && toast.success("Added"))
            }
          >
            {menu === "footer" ? "Add column" : "Add menu"}
          </Button>
        </div>
      </Container>

      {mine.map((section, index) => {
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
                value={section.label}
                onChange={(e) =>
                  setSections((rows) =>
                    rows.map((r) =>
                      r.id === section.id ? { ...r, label: e.target.value } : r
                    )
                  )
                }
              />
              <Input
                className="w-80"
                placeholder="Link (blank = dropdown only)"
                value={section.href ?? ""}
                onChange={(e) =>
                  setSections((rows) =>
                    rows.map((r) =>
                      r.id === section.id ? { ...r, href: e.target.value } : r
                    )
                  )
                }
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
                  variant="secondary"
                  onClick={() =>
                    call(`/admin/content/menu-sections/${section.id}`, {
                      label: section.label,
                      href: section.href,
                    }).then((ok) => ok && toast.success("Saved"))
                  }
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
                  onClick={() => {
                    if (
                      confirm(
                        `Delete "${section.label}" and its ${links.length} links?`
                      )
                    ) {
                      call(
                        `/admin/content/menu-sections/${section.id}`,
                        undefined,
                        "DELETE"
                      )
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>

            {isOpen ? (
              <div className="px-6 py-4">
                <div className="flex flex-col gap-y-2">
                  {links.map((item, i) => (
                    <div key={item.id} className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-x-1">
                        <Button
                          size="small"
                          variant="transparent"
                          disabled={i === 0}
                          onClick={() => moveItem(section.id, i, -1)}
                          aria-label="Move up"
                        >
                          ↑
                        </Button>
                        <Button
                          size="small"
                          variant="transparent"
                          disabled={i === links.length - 1}
                          onClick={() => moveItem(section.id, i, 1)}
                          aria-label="Move down"
                        >
                          ↓
                        </Button>
                      </div>
                      {useGroups ? (
                        <Input
                          className="w-44"
                          placeholder="Group heading"
                          value={item.group ?? ""}
                          onChange={(e) =>
                            setItems((rows) =>
                              rows.map((r) =>
                                r.id === item.id
                                  ? { ...r, group: e.target.value }
                                  : r
                              )
                            )
                          }
                        />
                      ) : null}
                      <Input
                        className="w-52"
                        value={item.label}
                        onChange={(e) =>
                          setItems((rows) =>
                            rows.map((r) =>
                              r.id === item.id
                                ? { ...r, label: e.target.value }
                                : r
                            )
                          )
                        }
                      />
                      <Input
                        className="w-96"
                        value={item.href}
                        onChange={(e) =>
                          setItems((rows) =>
                            rows.map((r) =>
                              r.id === item.id
                                ? { ...r, href: e.target.value }
                                : r
                            )
                          )
                        }
                      />
                      <Input
                        className="w-24"
                        placeholder="Badge"
                        value={item.badge ?? ""}
                        onChange={(e) =>
                          setItems((rows) =>
                            rows.map((r) =>
                              r.id === item.id
                                ? { ...r, badge: e.target.value }
                                : r
                            )
                          )
                        }
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
                        variant="secondary"
                        onClick={() =>
                          call(`/admin/content/menu-items/${item.id}`, {
                            label: item.label,
                            href: item.href,
                            group: item.group ?? "",
                            badge: item.badge ?? "",
                          }).then((ok) => ok && toast.success("Saved"))
                        }
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
                          )
                        }
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  className="mt-3"
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    call("/admin/content/menu-items", {
                      section_id: section.id,
                      label: "New link",
                      href: "/",
                    })
                  }
                >
                  Add link
                </Button>
              </div>
            ) : null}
          </Container>
        )
      })}
    </div>
  )
}
