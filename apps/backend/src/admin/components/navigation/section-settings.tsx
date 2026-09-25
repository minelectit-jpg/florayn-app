import { Badge, Button, Checkbox, Input, Label, Text } from "@medusajs/ui"
import { useEffect, useId, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"

import { sortNewestFirst } from "../../../lib/device-order"
import { DEVICE_FAMILIES, type DeviceFamilyKey } from "../../../lib/storefront-presentation"
import { api, ManagerSelect } from "../product-manager/shared"
import {
  FAMILY_NAMES,
  FORM_OPTIONS,
  fitsEveryFamily,
  formsOf,
  type CaseTypesConfig,
  type CatalogCaseType,
  type CatalogDevice,
  type CollectionsConfig,
  type DevicesConfig,
  type ProductForm,
} from "./section-input"

/*
 * The settings of the automatic header sections: Device models, Case styles
 * and the Collections row. The Links type keeps the grouped links editor in
 * menu-editor.tsx.
 */

export type NavigationCatalog = {
  /** The active case types: what the settings list and a section may point to. */
  caseTypes: CatalogCaseType[]
  /** Every case type, switched off ones too, so saving never drops their settings. */
  allCaseTypes: CatalogCaseType[]
  devices: CatalogDevice[]
}

/** Case types (with the families they fit) and every device, newest first per family. */
async function loadNavigationCatalog(): Promise<NavigationCatalog> {
  const [types, models] = await Promise.all([api("/admin/case-types"), api("/admin/devices")])
  // GET /admin/case-types returns each case type with its devices.
  const rows: any[] = (types.case_types ?? []).map((c: any) => ({ ...c, devices: Array.isArray(c.devices) ? c.devices : [] }))
  const devices = sortNewestFirst<CatalogDevice>(models.devices ?? [], (d) => d.name, (d) => d.family)
  return { caseTypes: rows.filter((c) => c.is_active !== false), allCaseTypes: rows, devices }
}

export function useNavigationCatalog(enabled: boolean) {
  const [catalog, setCatalog] = useState<NavigationCatalog | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!enabled) return
    let live = true
    loadNavigationCatalog()
      .then((next) => { if (live) setCatalog(next) })
      .catch((e: any) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [enabled])
  return { catalog, error }
}

function CatalogState({ error }: { error: string }) {
  return (
    <Text size="small" className={error ? "text-ui-fg-error" : "text-ui-fg-subtle"}>
      {error ? `Could not load case types and models: ${error}` : "Loading case types and models..."}
    </Text>
  )
}

const Note = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
    <Text size="small">{children}</Text>
  </div>
)

const PREVIEW_MODELS = 6

/** What the menu will list: each chosen brand and its first models, as the store orders them. */
function DevicesPreview({ families, devices }: { families: DeviceFamilyKey[]; devices: CatalogDevice[] }) {
  return (
    <div className="grid gap-3" aria-label="Preview">
      <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">Preview</Text>
      {families.map((family) => {
        const models = devices.filter((d) => d.family === family && d.is_active)
        return (
          <div key={family} className="grid gap-1">
            <Text size="small" weight="plus">{FAMILY_NAMES[family]}</Text>
            {models.length ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {models.slice(0, PREVIEW_MODELS).map((d) => (
                  <span key={d.id} className="flex items-center gap-1">
                    <Text size="small" className="text-ui-fg-subtle">{d.name}</Text>
                    {d.badge ? <Badge size="2xsmall" color="green">{d.badge}</Badge> : null}
                  </span>
                ))}
                {models.length > PREVIEW_MODELS ? (
                  <Text size="small" className="text-ui-fg-muted">+{models.length - PREVIEW_MODELS} more</Text>
                ) : null}
              </div>
            ) : (
              <Text size="small" className="text-ui-fg-muted">No models are shown on the store.</Text>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function DeviceModelsSettings({ config, onChange, catalog, catalogError }: {
  config: DevicesConfig
  onChange: (config: DevicesConfig) => void
  catalog: NavigationCatalog | null
  catalogError: string
}) {
  const id = useId()
  const chosen = config.families
  const rest = DEVICE_FAMILIES.filter((f) => !chosen.includes(f))
  const setFamilies = (families: DeviceFamilyKey[]) => onChange({ ...config, families })
  const move = (index: number, delta: number) => {
    const next = [...chosen]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    setFamilies(next)
  }
  const fitting = (catalog?.caseTypes ?? []).filter((c) => fitsEveryFamily(c, chosen))
  const current = config.case_type ? catalog?.caseTypes.find((c) => c.slug === config.case_type) : null
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label size="small">Brands</Label>
        <div className="grid gap-1.5">
          {chosen.map((family, index) => (
            <div key={family} className="flex items-center gap-2">
              <Checkbox id={`${id}-${family}`} checked onCheckedChange={() => setFamilies(chosen.filter((f) => f !== family))} />
              <Label htmlFor={`${id}-${family}`} size="small" className="min-w-36">{FAMILY_NAMES[family]}</Label>
              <Button size="small" variant="transparent" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${FAMILY_NAMES[family]} up`}>↑</Button>
              <Button size="small" variant="transparent" disabled={index === chosen.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${FAMILY_NAMES[family]} down`}>↓</Button>
            </div>
          ))}
          {rest.map((family) => (
            <div key={family} className="flex items-center gap-2">
              <Checkbox id={`${id}-${family}`} checked={false} onCheckedChange={() => setFamilies([...chosen, family])} />
              <Label htmlFor={`${id}-${family}`} size="small" className="text-ui-fg-subtle">{FAMILY_NAMES[family]}</Label>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-2 md:max-w-md">
        <Label size="small" htmlFor={`${id}-case-type`}>Case type for model links</Label>
        {catalog ? (
          <ManagerSelect id={`${id}-case-type`} value={config.case_type ?? ""} onValueChange={(slug) => onChange({ ...config, case_type: slug || null })}>
            <option value="">Device&apos;s first style (fastest page)</option>
            {fitting.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            {config.case_type && !fitting.some((c) => c.slug === config.case_type) ? (
              <option value={config.case_type}>{current ? `${current.name} (not made for every brand above)` : config.case_type}</option>
            ) : null}
          </ManagerSelect>
        ) : <CatalogState error={catalogError} />}
      </div>

      <Note>
        Models are listed automatically from <Link className="text-ui-fg-interactive underline" to="/devices">Devices</Link>, newest first. Hide a model or mark it New in Devices.
      </Note>

      {catalog ? <DevicesPreview families={chosen} devices={catalog.devices} /> : null}
    </div>
  )
}

export function CaseStylesSettings({ config, onChange, catalog, catalogError }: {
  config: CaseTypesConfig
  onChange: (config: CaseTypesConfig) => void
  catalog: NavigationCatalog | null
  catalogError: string
}) {
  const id = useId()
  const rows = (catalog?.caseTypes ?? []).filter((c) => formsOf(c).includes(config.form))
  const formName = FORM_OPTIONS.find((f) => f.value === config.form)?.label ?? config.form
  const show = (slug: string, on: boolean) =>
    onChange({ ...config, exclude: on ? config.exclude.filter((s) => s !== slug) : [...config.exclude, slug] })
  const setLink = (slug: string, href: string) => onChange({ ...config, links: { ...config.links, [slug]: href } })
  return (
    <div className="grid gap-5">
      <div className="grid gap-2 md:max-w-xs">
        <Label size="small" htmlFor={`${id}-form`}>Product</Label>
        <ManagerSelect id={`${id}-form`} value={config.form} onValueChange={(form) => onChange({ ...config, form: form as ProductForm })}>
          {FORM_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </ManagerSelect>
      </div>

      {!catalog ? <CatalogState error={catalogError} /> : rows.length ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-x-3 gap-y-2">
            <Text size="xsmall" weight="plus" className="text-ui-fg-muted">Show</Text>
            <Text size="xsmall" weight="plus" className="text-ui-fg-muted">Case type</Text>
            <Text size="xsmall" weight="plus" className="text-ui-fg-muted">Link (optional)</Text>
            {rows.map((c) => (
              <div key={c.slug} className="contents">
                <Checkbox id={`${id}-${c.slug}`} checked={!config.exclude.includes(c.slug)} onCheckedChange={(v) => show(c.slug, v === true)} />
                <Label htmlFor={`${id}-${c.slug}`} size="small" className="flex min-w-0 items-center gap-2">
                  <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-ui-border-base bg-ui-bg-subtle">
                    {c.image_url ? <img src={c.image_url} alt="" className="h-full w-full object-cover" /> : null}
                  </span>
                  <span className="truncate">{c.name}</span>
                </Label>
                <Input
                  size="small"
                  aria-label={`${c.name} link`}
                  placeholder="The shop for the shopper's phone"
                  value={config.links[c.slug] ?? ""}
                  onChange={(e) => setLink(c.slug, e.target.value)}
                />
              </div>
            ))}
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle">A blank Link means the shop for the shopper&apos;s phone.</Text>
        </div>
      ) : (
        <Text size="small" className="text-ui-fg-subtle">No active case type is made for {formName} yet.</Text>
      )}

      <Note>
        Name, photo and price come from <Link className="text-ui-fg-interactive underline" to="/case-types">Case types</Link>.
      </Note>
    </div>
  )
}

export function CollectionsRowSettings({ config, onChange }: {
  config: CollectionsConfig
  onChange: (config: CollectionsConfig) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="grid content-start gap-2">
          <Label size="small" htmlFor={`${id}-title`}>Title</Label>
          <Input id={`${id}-title`} maxLength={40} value={config.title} onChange={(e) => onChange({ ...config, title: e.target.value })} />
        </div>
        <div className="grid content-start gap-2">
          <Label size="small" htmlFor={`${id}-all`}>View all link</Label>
          <Input id={`${id}-all`} placeholder="/collections/" value={config.view_all_href} onChange={(e) => onChange({ ...config, view_all_href: e.target.value })} />
        </div>
        <div className="grid content-start gap-2">
          <Label size="small" htmlFor={`${id}-limit`}>Cards to show</Label>
          <Input
            id={`${id}-limit`}
            type="number"
            min={1}
            max={12}
            step={1}
            value={Number.isFinite(config.limit) ? config.limit : ""}
            onChange={(e) => onChange({ ...config, limit: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
          />
        </div>
      </div>
      <Note>
        Choose collections with Show in menu in <Link className="text-ui-fg-interactive underline" to="/collection-pages">Collection pages</Link>; they follow that page&apos;s order.
      </Note>
    </div>
  )
}
