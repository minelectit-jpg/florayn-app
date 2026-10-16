import { Badge, Button, Heading, Label, Text, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { addableColours, colourBody, colourDraft, colourOf, colourSummary, draftProblem, modelPalette, sameDraft, type ColourDraft, type ModelPalette } from "./phone-colours-draft"
import { Gallery, ManagerSelect, post, type DesignPalette, type Variant } from "./shared"

type Props = {
  variant: Variant
  palette: DesignPalette | undefined
  /** The design's web address (POST /admin/designs/<slug>/colours). */
  slug: string
  /** The variant editor is saving or uploading. */
  disabled: boolean
  onSaved: () => void
  onDirtyChange: (value: boolean) => void
  onBusyChange: (value: boolean) => void
}

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key)

function Dot({ hex }: { hex?: string }) {
  return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full" style={{ background: hex ?? "#c9c9cf", boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.15)" }} />
}

/**
 * Phone colour pictures of ONE case variant (PHONE_COLOURS.md): which phone
 * colour the main gallery shows, plus a gallery per extra colour. Display only:
 * nothing here changes options, variants, prices or stock. Saved through
 * POST /admin/designs/:slug/colours, separately from "Save variant changes".
 */
export default function PhoneColoursEditor(props: Props) {
  const entry = modelPalette(props.palette, props.variant.deviceSlug)
  return <section className="grid gap-3 border-t pt-4" aria-label="Phone colour pictures">
    <Heading level="h3">Phone colour pictures</Heading>
    {entry
      ? <ColoursForm {...props} entry={entry} />
      : <Text size="small" className="text-ui-fg-subtle">This model has no phone colours (Console &gt; Mockup Studio &gt; Mockup sets).</Text>}
  </section>
}

function ColoursForm({ variant, slug, disabled, onSaved, onDirtyChange, onBusyChange, entry }: Props & { entry: ModelPalette }) {
  // Re-read the saved rows whenever a refresh brings new ones (or a new palette).
  const savedKey = JSON.stringify([variant.phoneColours ?? null, entry])
  const saved = colourDraft(variant.phoneColours, entry)
  const [draft, setDraft] = useState<ColourDraft>(saved.draft)
  const [baseline, setBaseline] = useState<ColourDraft>(saved.draft)
  // A refresh brought other saved rows: keep the admin's unsaved edits, otherwise
  // show what is saved now. Runs only for the render in which savedKey changed.
  const seen = useRef(savedKey)
  useEffect(() => {
    if (seen.current === savedKey) return
    seen.current = savedKey
    const next = saved.draft
    setDraft((current) => sameDraft(current, baseline) ? next : current)
    setBaseline(next)
  }, [savedKey, saved.draft, baseline])
  const [busy, setBusy] = useState(false)
  const [uploads, setUploads] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const lock = useRef(false)

  const dirty = !sameDraft(draft, baseline)
  // A variant without a usable main row (or with colours that left the palette)
  // can be saved as shown, e.g. to record "the main gallery shows Black".
  const canSave = dirty || saved.untagged || saved.stale.length > 0
  const problem = draftProblem(entry, draft)
  const working = busy || uploads > 0
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(working); return () => onBusyChange(false) }, [working, onBusyChange])

  const extras = entry.colours.filter(([s]) => own(draft.extra, s))
  const addable = addableColours(entry, draft)
  const mainHex = colourOf(entry, draft.main)?.[2]
  const setExtra = (colour: string, urls: string[]) => setDraft((d) => ({ ...d, extra: { ...d.extra, [colour]: urls } }))
  const removeExtra = (colour: string) => setDraft((d) => { const extra = { ...d.extra }; delete extra[colour]; return { ...d, extra } })
  const uploadBusy = (on: boolean) => setUploads((n) => Math.max(0, n + (on ? 1 : -1)))

  async function save() {
    if (lock.current || working) return
    if (problem) { toast.error(problem); return }
    lock.current = true; setBusy(true); setWarnings([])
    const sent = draft
    try {
      const result = await post(`/admin/designs/${encodeURIComponent(slug)}/colours`, colourBody(variant.id, entry, sent))
      setWarnings(Array.isArray(result?.warnings) ? result.warnings.filter((w: unknown): w is string => typeof w === "string") : [])
      setBaseline(sent)
      toast.success("Phone colours saved.")
      onSaved()
    } catch (error: any) {
      // A timed-out save may have completed: refresh before the admin retries.
      toast.error(error.message)
      onSaved()
    } finally { lock.current = false; setBusy(false) }
  }

  const off = disabled || busy
  return <div className="grid gap-4">
    <Text size="small" className="text-ui-fg-subtle">Shoppers pick the phone colour on the product page and only the pictures change. The case, price and stock are the same for every phone colour.</Text>
    <div className="grid gap-1">
      <Label htmlFor={`main-colour-${variant.id}`}>Main gallery shows</Label>
      <div className="flex items-center gap-2"><Dot hex={mainHex} /><div className="min-w-0 flex-1"><ManagerSelect id={`main-colour-${variant.id}`} aria-label="Main gallery shows" value={draft.main} onValueChange={(value) => { if (value && !off) setDraft((d) => ({ ...d, main: value })) }}>{entry.colours.map(([s, name]) => <option key={s} value={s}>{s === entry.default ? `${name} (model default)` : name}</option>)}</ManagerSelect></div></div>
      <Text size="xsmall" className="text-ui-fg-muted">The gallery above (Save variant changes) is this colour. The shop grid, bag and ads always show it.</Text>
      {saved.untagged && <Text size="xsmall" className="text-ui-fg-subtle">No phone colour is saved for this variant yet, so shoppers get no colour choice. Saving records which colour the main gallery shows.</Text>}
      {saved.stale.length > 0 && <Text size="xsmall" className="text-ui-fg-subtle">No longer in this model's Mockup set, so shoppers never see them: {saved.stale.join(", ")}. Saving removes them.</Text>}
    </div>
    {extras.map(([colour, name, hex]) => <div key={colour} className="grid gap-2 rounded-lg border border-ui-border-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2"><Dot hex={hex} /><Text size="small" weight="plus">{name}</Text><Text size="xsmall" className="text-ui-fg-muted">{draft.extra[colour].length} {draft.extra[colour].length === 1 ? "picture" : "pictures"}</Text></span>
        <Button size="small" variant="secondary" disabled={off || uploads > 0} onClick={() => removeExtra(colour)}>Remove colour</Button>
      </div>
      <Gallery images={draft.extra[colour]} onChange={(urls) => setExtra(colour, urls)} slug={slug} disabled={off} onBusy={uploadBusy}
        folder={{ caseTypeSlug: variant.caseTypeSlug ?? "", deviceSlug: variant.deviceSlug ?? "", colourSlug: colour }}
        label={`Upload ${name} pictures`} hint="Use the same shots in the same order as the main gallery, so shoppers keep their angle when they switch colour." />
    </div>)}
    {addable.length > 0 && <div className="grid max-w-sm gap-1">
      <ManagerSelect aria-label="Add phone colour" value="" onValueChange={(value) => { if (value && !off && !own(draft.extra, value) && value !== draft.main) setDraft((d) => ({ ...d, extra: { ...d.extra, [value]: [] } })) }}>
        <option value="">Add phone colour</option>
        {addable.map(([s, name]) => <option key={s} value={s}>{name}</option>)}
      </ManagerSelect>
    </div>}
    <Text size="xsmall" className="text-ui-fg-muted">{colourSummary(entry, draft)}</Text>
    {problem && <Text size="small" className="text-ui-fg-error" role="alert">{problem}</Text>}
    {warnings.length > 0 && <div className="grid gap-1" role="status">{warnings.map((w, i) => <Text key={i} size="small" className="text-ui-fg-subtle">{w}</Text>)}</div>}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" isLoading={busy} disabled={disabled || uploads > 0 || !canSave || Boolean(problem)} onClick={save}>Save phone colours</Button>
      {dirty && <Button variant="transparent" disabled={off || uploads > 0} onClick={() => { setDraft(baseline); setWarnings([]) }}>Discard colour changes</Button>}
      {dirty && <Badge color="orange">Unsaved phone colours</Badge>}
    </div>
  </div>
}
