import { defineRouteConfig } from "@medusajs/admin-sdk"
import { MagnifyingGlass } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type Settings = {
  id: string
  title_template: string
  description_template: string
  heading_template: string
  fit_copy_enabled: boolean
}

type Override = {
  id: string
  scope: "design" | "device"
  key: string
  title: string | null
  description: string | null
  fit_copy: string | null
  is_active: boolean
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`)
  return body
}

/** Fills {design}, {device} and {caseType}, tidying the gap a blank leaves. */
function render(template: string, v: Record<string, string>) {
  return template
    .replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

const SeoPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [overrides, setOverrides] = useState<Override[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({
    scope: "design" as "design" | "device",
    key: "",
    title: "",
    description: "",
    fit_copy: "",
  })
  // What the preview substitutes, so the effect of a template edit is visible.
  const [sample, setSample] = useState({
    design: "Amber Leopard",
    device: "iPhone 13 Pro",
    caseType: "Signature",
  })

  function load() {
    setLoading(true)
    api("/admin/content/seo")
      .then((d) => {
        setSettings(d.settings)
        setOverrides(d.overrides ?? [])
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function saveTemplates() {
    if (!settings) return
    try {
      const d = await api("/admin/content/seo", {
        method: "POST",
        body: JSON.stringify(settings),
      })
      setSettings(d.settings)
      setOverrides(d.overrides)
      toast.success("Templates saved")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function addOverride() {
    if (!draft.key.trim()) {
      toast.error("Give it a design or device slug")
      return
    }
    try {
      const d = await api("/admin/content/seo/overrides", {
        method: "POST",
        body: JSON.stringify(draft),
      })
      setOverrides(d.overrides)
      setDraft({ scope: draft.scope, key: "", title: "", description: "", fit_copy: "" })
      toast.success("Override added")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function removeOverride(id: string) {
    try {
      const d = await api(`/admin/content/seo/overrides/${id}`, { method: "DELETE" })
      setOverrides(d.overrides)
      toast.success("Override removed")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  if (loading || !settings) {
    return (
      <Container>
        <Text>{loading ? "Loading SEO settings..." : "Could not load."}</Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">SEO</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Every design x case type x device has its own page. These templates
            fill its title, heading and description;{" "}
            <code>{"{design}"}</code>, <code>{"{device}"}</code> and{" "}
            <code>{"{caseType}"}</code> are substituted.
          </Text>
        </div>

        <div className="grid gap-4 px-6 py-4">
          {(
            [
              ["title_template", "Title"],
              ["heading_template", "Heading (H1)"],
              ["description_template", "Meta description"],
            ] as [keyof Settings, string][]
          ).map(([key, label]) => (
            <div key={String(key)}>
              <Label size="small">{label}</Label>
              <Input
                value={(settings[key] as string) ?? ""}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: e.target.value })
                }
              />
              <Text size="xsmall" className="text-ui-fg-subtle pt-1">
                {render(String(settings[key] ?? ""), sample)}
                {key === "description_template"
                  ? `  (${render(String(settings[key] ?? ""), sample).length} chars)`
                  : ""}
              </Text>
            </div>
          ))}

          <div className="flex items-center gap-x-3">
            <Label size="small">Show the generated fit sentence</Label>
            <Switch
              checked={settings.fit_copy_enabled}
              onCheckedChange={(v) =>
                setSettings({ ...settings, fit_copy_enabled: v })
              }
            />
            <Text size="xsmall" className="text-ui-fg-subtle">
              Built from each model&rsquo;s lens count, Action Button, Camera
              Control and MagSafe. Inferred from the hardware, not supplied by
              Florayn &mdash; correct anything wrong with a device override.
            </Text>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <Label size="small">Preview with</Label>
          {(["design", "device", "caseType"] as const).map((k) => (
            <Input
              key={k}
              className="w-44"
              value={sample[k]}
              onChange={(e) => setSample({ ...sample, [k]: e.target.value })}
            />
          ))}
          <div className="ml-auto">
            <Button size="small" onClick={saveTemplates}>
              Save templates
            </Button>
          </div>
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Overrides</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            A device override beats a design override, which beats the
            templates. Leave a field blank to keep the generated value.
          </Text>
        </div>

        {overrides.length ? (
          <div className="flex flex-col gap-y-2 px-6 py-4">
            {overrides.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2">
                <Badge size="2xsmall">{o.scope}</Badge>
                <Text size="small" weight="plus" className="w-52">
                  {o.key}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle flex-1 truncate">
                  {[o.title, o.description, o.fit_copy].filter(Boolean).join(" · ") ||
                    "(no fields set)"}
                </Text>
                <Button
                  size="small"
                  variant="danger"
                  onClick={() => removeOverride(o.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No overrides. Everything uses the templates above.
            </Text>
          </div>
        )}

        <div className="grid gap-3 px-6 py-4 md:grid-cols-2">
          <div>
            <Label size="small">Applies to</Label>
            <Select
              value={draft.scope}
              onValueChange={(v) =>
                setDraft({ ...draft, scope: v as "design" | "device" })
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="design">A design</Select.Item>
                <Select.Item value="device">A device</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label size="small">
              {draft.scope === "design" ? "Design slug" : "Device slug"}
            </Label>
            <Input
              placeholder={
                draft.scope === "design" ? "amber-leopard" : "iphone-16-pro"
              }
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
          </div>
          <div>
            <Label size="small">Title</Label>
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div>
            <Label size="small">Meta description</Label>
            <Input
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </div>
          <div className="md:col-span-2">
            <Label size="small">Fit sentence</Label>
            <Textarea
              rows={2}
              placeholder="Replaces the generated sentence for this design or device."
              value={draft.fit_copy}
              onChange={(e) => setDraft({ ...draft, fit_copy: e.target.value })}
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button size="small" variant="secondary" onClick={addOverride}>
              Add override
            </Button>
          </div>
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "SEO",
  icon: MagnifyingGlass,
})

export default SeoPage
