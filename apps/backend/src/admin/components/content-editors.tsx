import { Button, Input, Label, Text, Textarea } from "@medusajs/ui"
import { useState, type ReactNode } from "react"

import MediaPicker from "./media-picker"
import { ManagerSelect } from "./product-manager/shared"

/*
 * Small building blocks shared by the Home page and Collection pages editors:
 * an image field backed by the R2 media picker, a colour field, and a list
 * editor for repeated items (slides, tiles, quotes, banners).
 */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="small">{label}</Label>
      {children}
      {hint ? <Text size="xsmall" className="text-ui-fg-subtle">{hint}</Text> : null}
    </div>
  )
}

export function TextField({
  label, value, onChange, hint, placeholder, multiline = false,
}: {
  label: string
  value: string | null | undefined
  onChange: (value: string) => void
  hint?: string
  placeholder?: string
  multiline?: boolean
}) {
  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <Textarea rows={3} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  )
}

/** A picture: preview, pick from (or upload to) R2, clear, or paste a URL. */
export function ImageField({
  label, value, onChange, hint, square = false,
}: {
  label: string
  value: string | null | undefined
  onChange: (value: string | null) => void
  hint?: string
  square?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-start gap-3">
        <div
          className={`bg-ui-bg-subtle border-ui-border-base flex shrink-0 items-center justify-center overflow-hidden rounded-md border ${square ? "h-16 w-16" : "h-16 w-28"}`}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <Text size="xsmall" className="text-ui-fg-muted">None</Text>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-y-2">
          <div className="flex gap-x-2">
            <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
              {value ? "Change" : "Choose"}
            </Button>
            {value ? (
              <Button size="small" variant="transparent" onClick={() => onChange(null)}>
                Clear
              </Button>
            ) : null}
          </div>
          <Input
            size="small"
            value={value ?? ""}
            placeholder="or paste an https:// image URL"
            onChange={(e) => onChange(e.target.value.trim() || null)}
          />
        </div>
      </div>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        accept="image"
        title={`Choose: ${label}`}
        onSelect={(url) => onChange(url)}
      />
    </Field>
  )
}

const HEX6 = /^#[0-9a-f]{6}$/i

/** A colour: swatch picker plus the hex, with an optional "none" for borders. */
export function ColorField({
  label, value, onChange, allowNone = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  allowNone?: boolean
}) {
  const none = value === "transparent"
  const swatch = HEX6.test(value)
    ? value
    : /^#[0-9a-f]{3}$/i.test(value)
      ? `#${value.slice(1).split("").map((c) => c + c).join("")}`
      : "#ffffff"
  return (
    <Field label={label}>
      <div className="flex items-center gap-x-2">
        <input
          type="color"
          aria-label={`${label} colour`}
          value={swatch}
          disabled={none}
          onChange={(e) => onChange(e.target.value)}
          className="border-ui-border-base h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5 disabled:opacity-40"
        />
        <Input size="small" value={value} onChange={(e) => onChange(e.target.value.trim())} className="font-mono" />
        {allowNone ? (
          <label className="flex shrink-0 items-center gap-x-1 text-xs">
            <input type="checkbox" checked={none} onChange={(e) => onChange(e.target.checked ? "transparent" : "#e9e6ef")} />
            None
          </label>
        ) : null}
      </div>
    </Field>
  )
}

export type ListField<T> = {
  key: keyof T & string
  label: string
  kind?: "text" | "textarea" | "image" | "select"
  options?: { value: string; label: string }[]
  hint?: string
  placeholder?: string
  /** Grid span (1 or 2 of 2 columns). */
  wide?: boolean
}

/**
 * Repeated items with add, remove and move up/down. Each item renders the
 * given fields; images use the media picker.
 */
export function ListEditor<T extends Record<string, any>>({
  items, onChange, fields, blank, itemLabel, max = 12, describe,
}: {
  items: T[]
  onChange: (items: T[]) => void
  fields: ListField<T>[]
  blank: () => T
  itemLabel: string
  max?: number
  describe?: (item: T, index: number) => string
}) {
  const set = (index: number, key: string, value: unknown) =>
    onChange(items.map((item, i) => (i === index ? { ...item, [key]: value } : item)))
  const move = (index: number, delta: number) => {
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-y-3">
      {items.map((item, index) => (
        <div key={index} className="border-ui-border-base rounded-lg border">
          <div className="bg-ui-bg-subtle flex items-center gap-x-2 rounded-t-lg px-3 py-2">
            <Text size="small" weight="plus" className="flex-1 truncate">
              {itemLabel} {index + 1}
              {describe ? <span className="text-ui-fg-subtle font-normal"> - {describe(item, index)}</span> : null}
            </Text>
            <Button size="small" variant="transparent" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">↑</Button>
            <Button size="small" variant="transparent" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label="Move down">↓</Button>
            <Button size="small" variant="transparent" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </div>
          <div className="grid gap-3 p-3 md:grid-cols-2">
            {fields.map((field) => {
              const value = item[field.key]
              const span = field.wide || field.kind === "textarea" ? "md:col-span-2" : ""
              if (field.kind === "image") {
                return (
                  <div key={field.key} className={span}>
                    <ImageField label={field.label} hint={field.hint} value={value} onChange={(v) => set(index, field.key, v)} />
                  </div>
                )
              }
              if (field.kind === "select") {
                return (
                  <div key={field.key} className={span}>
                    <Field label={field.label} hint={field.hint}>
                      <ManagerSelect aria-label={field.label} value={String(value ?? "")} onValueChange={(v) => set(index, field.key, v)}>
                        {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </ManagerSelect>
                    </Field>
                  </div>
                )
              }
              return (
                <div key={field.key} className={span}>
                  <TextField
                    label={field.label}
                    hint={field.hint}
                    placeholder={field.placeholder}
                    multiline={field.kind === "textarea"}
                    value={value}
                    onChange={(v) => set(index, field.key, v)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {items.length < max ? (
        <div>
          <Button size="small" variant="secondary" onClick={() => onChange([...items, blank()])}>
            + Add {itemLabel.toLowerCase()}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
