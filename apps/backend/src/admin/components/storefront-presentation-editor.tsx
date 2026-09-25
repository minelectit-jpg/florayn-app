import { Button, Container, Heading, Input, Label, Switch, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { DELIVERY_ICONS, DEVICE_FAMILIES, validateBuyBoxPresentation, validateDeliveryPresentation, validateFooterPresentation, validateNavigationPresentation, validateSearchPresentation, type BuyBoxPresentation, type DeliveryPresentation, type DeviceFamilyKey, type FooterPresentation, type NavigationPresentation, type SearchPresentation } from "../../lib/storefront-presentation"
import { contentApi } from "./menu-editor"
import { ManagerSelect, useUnsaved } from "./product-manager/shared"

const VALIDATORS = { footer: validateFooterPresentation, delivery: validateDeliveryPresentation, buy_box: validateBuyBoxPresentation, navigation: validateNavigationPresentation, search: validateSearchPresentation }

/** `prepare` tidies the value (and may throw a clearer message) before the shared validator runs. */
function useSettings<T>(section: keyof typeof VALIDATORS, prepare?: (value: T) => T) {
  const [value, setValue] = useState<T | null>(null)
  const [saved, setSaved] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const lock = useRef(false)
  const dirty = JSON.stringify(value) !== JSON.stringify(saved)
  useUnsaved(dirty)
  const path = `/admin/content/presentation/${section}`
  async function load() {
    setLoading(true)
    setError("")
    try { const data = await contentApi(path); setValue(data.settings); setSaved(data.settings) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [section])
  async function save() {
    if (lock.current || !value) return
    lock.current = true
    setSaving(true)
    setError("")
    try {
      const settings = VALIDATORS[section](prepare ? prepare(value) : value)
      const data = await contentApi(path, { method: "POST", body: JSON.stringify({ settings }) })
      setValue(data.settings)
      setSaved(data.settings)
      toast.success("Saved. Storefront content will refresh shortly.")
    } catch (e: any) { setError(e.message); toast.error(e.message) }
    finally { lock.current = false; setSaving(false) }
  }
  return { value, setValue, loading, saving, error, dirty, load, save, discard: () => { setValue(saved); setError("") } }
}

function Field({ label, value, onChange, max = 240, multiline = false, hint }: { label: string; value: string; onChange: (value: string) => void; max?: number; multiline?: boolean; hint?: string }) {
  const id = useId()
  return <div className="grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    {multiline ? <Textarea id={id} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} /> : <Input id={id} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />}
    {hint && <Text size="small" className="text-ui-fg-subtle">{hint}</Text>}
  </div>
}

function Frame({ title, description, state, children }: { title: string; description: string; state: ReturnType<typeof useSettings<any>>; children: ReactNode }) {
  return <Container className="mb-6">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><Heading level="h1">{title}</Heading><Text size="small" className="mt-2 text-ui-fg-subtle">{description}</Text></div>
      <div className="flex items-center gap-2">
        {state.dirty && <Text size="small" className="text-ui-fg-subtle">Unsaved changes</Text>}
        <Button variant="secondary" disabled={!state.dirty || state.saving} onClick={state.discard}>Discard</Button>
        <Button disabled={!state.value || !state.dirty || state.loading} isLoading={state.saving} onClick={state.save}>Save changes</Button>
      </div>
    </div>
    {state.error && <div role="alert" className="mb-4 rounded-lg border border-ui-border-error p-3 text-ui-fg-error">{state.error}</div>}
    {state.loading ? <Text>Loading settings...</Text> : !state.value ? <Button variant="secondary" onClick={state.load}>Retry loading</Button> :
      <fieldset disabled={state.saving} className="grid gap-6">{children}</fieldset>}
  </Container>
}

function RowActions({ index, length, move, remove }: { index: number; length: number; move: (delta: number) => void; remove: () => void }) {
  return <div className="flex flex-wrap gap-2">
    <Button size="small" variant="secondary" disabled={index === 0} onClick={() => move(-1)} aria-label={`Move item ${index + 1} up`}>Move up</Button>
    <Button size="small" variant="secondary" disabled={index === length - 1} onClick={() => move(1)} aria-label={`Move item ${index + 1} down`}>Move down</Button>
    <Button size="small" variant="danger" onClick={remove} aria-label={`Remove item ${index + 1}`}>Remove</Button>
  </div>
}
function moved<T>(items: T[], index: number, delta: number) {
  const next = [...items]
  if (index + delta < 0 || index + delta >= items.length) return next
  const item = next[index]
  next[index] = next[index + delta]
  next[index + delta] = item
  return next
}

export function FooterPresentationEditor() {
  const state = useSettings<FooterPresentation>("footer")
  const value = state.value
  const set = (patch: Partial<FooterPresentation>) => state.setValue((current) => current ? { ...current, ...patch } : current)
  return <Frame title="Footer appearance" description="Brand, support message, social links and bottom notes. Edit the menu columns below." state={state}>
    {value && <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Brand name" value={value.brand} max={40} onChange={(brand) => set({ brand })} />
        <Field label="Tagline" value={value.tagline} max={180} onChange={(tagline) => set({ tagline })} />
        <Field label="Support heading" value={value.support_title} max={80} onChange={(support_title) => set({ support_title })} />
        <Field label="Support message" value={value.support_text} multiline onChange={(support_text) => set({ support_text })} />
        <Field label="Support button label" value={value.support_label} max={60} onChange={(support_label) => set({ support_label })} />
        <Field label="Support button link" value={value.support_href} max={500} onChange={(support_href) => set({ support_href })} hint="For example /contact/. Leave both button fields blank to hide it." />
        <Field label="Copyright note" value={value.note} max={200} onChange={(note) => set({ note })} hint="Use {year} for the current year. Leave blank to hide." />
        <Field label="Location / currency note" value={value.location} max={80} onChange={(location) => set({ location })} hint="Display text only, not a currency selector. Leave blank to hide." />
      </div>
      <div className="grid gap-4">
        <Heading level="h2">Social links</Heading>
        <Text size="small" className="text-ui-fg-subtle">Use Facebook, Instagram or YouTube as the label for its icon. Other labels show a link icon.</Text>
        {value.social.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border border-ui-border-base p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={`Social ${index + 1} name`} value={row.label} max={40} onChange={(label) => set({ social: value.social.map((item, i) => i === index ? { ...item, label } : item) })} />
            <Field label={`Social ${index + 1} URL`} value={row.href} max={500} onChange={(href) => set({ social: value.social.map((item, i) => i === index ? { ...item, href } : item) })} />
          </div>
          <RowActions index={index} length={value.social.length} move={(delta) => set({ social: moved(value.social, index, delta) })} remove={() => set({ social: value.social.filter((_, i) => i !== index) })} />
        </div>)}
        <div><Button variant="secondary" disabled={value.social.length >= 8} onClick={() => set({ social: [...value.social, { label: "", href: "" }] })}>Add social link</Button></div>
      </div>
    </>}
  </Frame>
}

const iconNames: Record<string, string> = { truck: "Delivery truck", wallet: "Payment", "map-pin": "Location", refresh: "Exchange", package: "Package", heart: "Heart", shield: "Shield", phone: "Phone" }
export function DeliveryPresentationEditor() {
  const state = useSettings<DeliveryPresentation>("delivery")
  const value = state.value
  const set = (patch: Partial<DeliveryPresentation>) => state.setValue((current) => current ? { ...current, ...patch } : current)
  return <Frame title="Product delivery" description="The delivery line under the price and the delivery row in the product page's information list." state={state}>
    {value && <>
      <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
        <Text size="small">These fields change the displayed information only. Set actual shipping charges and delivery rules in Checkout settings, and keep this copy consistent with them.</Text>
      </div>
      <Field label="Delivery line under the price" value={value.estimate ?? ""} max={60} onChange={(estimate) => set({ estimate })} hint={`Shown as "In stock | ${value.estimate || "…"}" on every product page. Hidden when the item is sold out. Leave blank to show only "In stock".`} />
      <div className="flex items-center gap-3"><Switch id="show-product-delivery" checked={value.enabled} onCheckedChange={(enabled) => set({ enabled })} /><Label htmlFor="show-product-delivery">Show delivery information</Label></div>
      <Field label="Section heading" value={value.heading} max={80} onChange={(heading) => set({ heading })} hint="The row title in the product information list, for example Delivery & care." />
      <div className="grid gap-4 md:grid-cols-2">
        {value.cards.map((card, index) => <div key={index} className="grid content-start gap-4 rounded-lg border border-ui-border-base p-4">
          <div className="flex items-center justify-between"><Heading level="h2">Card {index + 1}</Heading></div>
          <div className="grid gap-2"><Label htmlFor={`delivery-icon-${index}`}>Icon</Label>
            <ManagerSelect id={`delivery-icon-${index}`} value={card.icon} onValueChange={(icon) => set({ cards: value.cards.map((item, i) => i === index ? { ...item, icon: icon as typeof card.icon } : item) })}>
              {DELIVERY_ICONS.map((icon) => <option key={icon} value={icon}>{iconNames[icon]}</option>)}
            </ManagerSelect>
          </div>
          <Field label={`Card ${index + 1} heading`} value={card.title} max={80} onChange={(title) => set({ cards: value.cards.map((item, i) => i === index ? { ...item, title } : item) })} />
          <Field label={`Card ${index + 1} description`} value={card.description} multiline onChange={(description) => set({ cards: value.cards.map((item, i) => i === index ? { ...item, description } : item) })} />
          <RowActions index={index} length={value.cards.length} move={(delta) => set({ cards: moved(value.cards, index, delta) })} remove={() => set({ cards: value.cards.filter((_, i) => i !== index) })} />
        </div>)}
      </div>
      <div><Button variant="secondary" disabled={value.cards.length >= 6} onClick={() => set({ cards: [...value.cards, { icon: "package", title: "", description: "" }] })}>Add information card</Button></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Help link label" value={value.link_label} max={60} onChange={(link_label) => set({ link_label })} />
        <Field label="Help link URL" value={value.link_href} max={500} onChange={(link_href) => set({ link_href })} hint="For example /contact/. Leave both link fields blank to hide it." />
      </div>
    </>}
  </Frame>
}

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="grid gap-1">
    <div className="flex items-center gap-3"><Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} /><Label htmlFor={id}>{label}</Label></div>
    {hint && <Text size="small" className="text-ui-fg-subtle">{hint}</Text>}
  </div>
}

/** A still picture of the buttons with the current values: no storefront code, just the look. */
function BuyBoxPreview({ value }: { value: BuyBoxPresentation }) {
  const pill = { height: 44, borderRadius: 30, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" as const }
  return <div aria-hidden="true" style={{ maxWidth: 380, padding: 16, borderRadius: 12, background: "#fbfaf8", border: "1px solid #e8e4de", color: "#1a1625" }}>
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ ...pill, width: 104, border: "1px solid #e8e4de", fontWeight: 400, color: "#6b6577" }}>−&nbsp;&nbsp;&nbsp;1&nbsp;&nbsp;&nbsp;+</div>
      <div style={{ ...pill, flex: 1, ...(value.add_to_cart_style === "filled" ? { background: "#1a1625", color: "#fff" } : { border: "1.5px solid #1a1625", background: "#fff" }) }}>{value.add_to_cart_label || "Add to cart"}</div>
      <div style={{ ...pill, width: 44, border: "1px solid #e8e4de" }}>♡</div>
    </div>
    <div style={{ ...pill, marginTop: 8, background: "#7c3aed", color: "#fff" }}>{value.buy_now_label || "Buy it now"}{value.show_price_in_buy_now ? <span style={{ opacity: 0.9 }}>&nbsp;·&nbsp;1,400.00৳</span> : null}</div>
  </div>
}

export function BuyBoxPresentationEditor() {
  const state = useSettings<BuyBoxPresentation>("buy_box")
  const value = state.value
  const set = (patch: Partial<BuyBoxPresentation>) => state.setValue((current) => current ? { ...current, ...patch } : current)
  return <Frame title="Buy buttons" description="The Add to cart and Buy it now buttons on every product page, the quick-buy bar on phones, and what shoppers see when a case is sold out." state={state}>
    {value && <>
      <div className="grid gap-4">
        <Heading level="h2">Button labels</Heading>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Add to cart label" value={value.add_to_cart_label} max={16} onChange={(add_to_cart_label) => set({ add_to_cart_label })} />
          <Field label="Buy it now label" value={value.buy_now_label} max={20} onChange={(buy_now_label) => set({ buy_now_label })} hint="For example Buy it now or Order now." />
        </div>
        <div className="grid gap-2 md:max-w-md"><Label htmlFor="buy-box-style">Add to cart style</Label>
          <ManagerSelect id="buy-box-style" value={value.add_to_cart_style} onValueChange={(style) => set({ add_to_cart_style: style as BuyBoxPresentation["add_to_cart_style"] })}>
            <option value="outline">Outline - Buy it now stays the one filled button</option>
            <option value="filled">Filled ink - the florayn.com look</option>
          </ManagerSelect>
        </div>
        <Toggle id="buy-box-price" label="Show the price in Buy it now" checked={value.show_price_in_buy_now} onChange={(show_price_in_buy_now) => set({ show_price_in_buy_now })} hint="Shows the selected case price times the quantity, for example Buy it now · 1,400.00৳. Delivery and pack savings are added at checkout." />
      </div>
      <div className="grid gap-4">
        <Heading level="h2">Quick-buy bar on phones and tablets</Heading>
        <Toggle id="buy-box-bar" label="Show the quick-buy bar" checked={value.sticky_bar} onChange={(sticky_bar) => set({ sticky_bar })} hint="Slides up at the bottom of the screen after the shopper scrolls past the buttons, with the price, the chosen model and one button. Never shown on computers, where the buttons stay in view." />
        <div className="grid gap-2 md:max-w-md"><Label htmlFor="buy-box-bar-action">Bar button</Label>
          <ManagerSelect id="buy-box-bar-action" value={value.sticky_bar_action} onValueChange={(action) => set({ sticky_bar_action: action as BuyBoxPresentation["sticky_bar_action"] })}>
            <option value="buy_now">{value.buy_now_label || "Buy it now"}</option>
            <option value="add_to_cart">{value.add_to_cart_label || "Add to cart"}</option>
          </ManagerSelect>
          {!value.sticky_bar ? <Text size="small" className="text-ui-fg-subtle">The bar is off.</Text> : null}
        </div>
      </div>
      <div className="grid gap-4">
        <Heading level="h2">When the selected case is sold out</Heading>
        <Toggle id="buy-box-soldout" label="Suggest case types that are in stock" checked={value.sold_out_suggestions} onChange={(sold_out_suggestions) => set({ sold_out_suggestions })} hint="Buy it now makes way for up to three in-stock case types for the same model, with their prices, one tap each." />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Label before the suggestions" value={value.sold_out_label} max={24} onChange={(sold_out_label) => set({ sold_out_label })} hint="Leave blank to show only the suggestions." />
          <Field label="Button when no case type is in stock" value={value.sold_out_other_model_label} max={24} onChange={(sold_out_other_model_label) => set({ sold_out_other_model_label })} hint="Opens the model list." />
        </div>
      </div>
      <div className="grid gap-3">
        <Heading level="h2">Preview</Heading>
        <BuyBoxPreview value={value} />
      </div>
    </>}
  </Frame>
}

const BRAND_FIELDS: Record<DeviceFamilyKey, string> = { iphone: "iPhone models", samsung: "Samsung models", airpods: "AirPods models", watch: "Watch models", wallet: "Wallet models" }

/** Admin > Navigation, under the menus: settings both the Women and Men menus share. */
export function NavigationPresentationEditor() {
  const state = useSettings<NavigationPresentation>("navigation")
  const value = state.value
  const set = (patch: Partial<NavigationPresentation>) => state.setValue((current) => current ? { ...current, ...patch } : current)
  return <Frame title="Navigation settings" description="Brand names, the links at the bottom of the phone menu and the remembered phone. The Women and Men menus share them." state={state}>
    {value && <>
      <div className="grid gap-4">
        <Heading level="h2">Brand names</Heading>
        <Text size="small" className="text-ui-fg-subtle">How each brand is named in the menu and in search.</Text>
        <div className="grid gap-4 md:grid-cols-3">
          {DEVICE_FAMILIES.map((family) => <Field key={family} label={BRAND_FIELDS[family]} value={value.family_labels[family]} max={30} onChange={(label) => set({ family_labels: { ...value.family_labels, [family]: label } })} />)}
        </div>
      </div>
      <div className="grid gap-4">
        <Heading level="h2">Menu bottom links</Heading>
        <Text size="small" className="text-ui-fg-subtle">Up to 6 links under the phone menu, for example My account.</Text>
        {value.drawer_links.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border border-ui-border-base p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={`Link ${index + 1} label`} value={row.label} max={40} onChange={(label) => set({ drawer_links: value.drawer_links.map((item, i) => i === index ? { ...item, label } : item) })} />
            <Field label={`Link ${index + 1} URL`} value={row.href} max={500} onChange={(href) => set({ drawer_links: value.drawer_links.map((item, i) => i === index ? { ...item, href } : item) })} hint={index === 0 ? "For example /account/." : undefined} />
          </div>
          <RowActions index={index} length={value.drawer_links.length} move={(delta) => set({ drawer_links: moved(value.drawer_links, index, delta) })} remove={() => set({ drawer_links: value.drawer_links.filter((_, i) => i !== index) })} />
        </div>)}
        <div><Button variant="secondary" disabled={value.drawer_links.length >= 6} onClick={() => set({ drawer_links: [...value.drawer_links, { label: "", href: "" }] })}>Add link</Button></div>
      </div>
      <Toggle id="navigation-remember-device" label="Remember the shopper's phone" checked={value.remember_device} onChange={(remember_device) => set({ remember_device })} hint="Shows Your phone at the top of the menu and search, from the models the shopper opened on this device. Nothing is sent to the server." />
    </>}
  </Frame>
}

const SUGGESTIONS_MAX = 8
const SYNONYMS_MAX = 100
const splitWords = (text: string) => text.split(",").map((word) => word.trim()).filter(Boolean)

/** Try chips: add, remove and reorder, up to 8 of 40 characters or fewer. */
function Chips({ id, label, items, onChange }: { id: string; label: string; items: string[]; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState("")
  const full = items.length >= SUGGESTIONS_MAX
  function add() {
    const text = draft.trim()
    if (!text || full) return
    if (!items.some((item) => item.toLowerCase() === text.toLowerCase())) onChange([...items, text])
    setDraft("")
  }
  return <div className="grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => <span key={`${item}-${index}`} className="flex items-center gap-0.5 rounded-full border border-ui-border-base bg-ui-bg-subtle py-0.5 pl-3 pr-1">
        <Text size="small">{item}</Text>
        <Button size="small" variant="transparent" disabled={index === 0} onClick={() => onChange(moved(items, index, -1))} aria-label={`Move ${item} earlier`}>←</Button>
        <Button size="small" variant="transparent" disabled={index === items.length - 1} onClick={() => onChange(moved(items, index, 1))} aria-label={`Move ${item} later`}>→</Button>
        <Button size="small" variant="transparent" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={`Remove ${item}`}>×</Button>
      </span>)}
      {!items.length && <Text size="small" className="text-ui-fg-muted">None. Search opens without Try chips.</Text>}
    </div>
    <div className="flex gap-2 md:max-w-md">
      <Input id={id} value={draft} maxLength={40} disabled={full} placeholder={full ? "Up to 8. Remove one to add another." : "e.g. iPhone 17 Pro Max"} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }} />
      <Button variant="secondary" disabled={!draft.trim() || full} onClick={add}>Add</Button>
    </div>
  </div>
}

/**
 * One synonym row. The words are typed as a comma list; the field keeps its
 * own text so a trailing comma or space survives while typing.
 */
function SynonymRow({ index, row, onChange, onRemove }: { index: number; row: SearchPresentation["synonyms"][number]; onChange: (row: SearchPresentation["synonyms"][number]) => void; onRemove: () => void }) {
  const [text, setText] = useState(row.words.join(", "))
  useEffect(() => {
    if (JSON.stringify(splitWords(text)) !== JSON.stringify(row.words)) setText(row.words.join(", "))
  }, [row.words])
  return <div className="grid items-center gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
    <Input aria-label={`Row ${index + 1}: when shoppers type`} value={text} placeholder="cover, covers, back cover" onChange={(e) => { setText(e.target.value); onChange({ ...row, words: splitWords(e.target.value) }) }} />
    <Input aria-label={`Row ${index + 1}: search for`} value={row.means} maxLength={40} placeholder="case" onChange={(e) => onChange({ ...row, means: e.target.value })} />
    <Button size="small" variant="transparent" onClick={onRemove} aria-label={`Remove synonym row ${index + 1}`}>Remove</Button>
  </div>
}

/** Drops empty rows and names the row a mistake is in, before the shared validator. */
export function tidySearch(value: SearchPresentation): SearchPresentation {
  const synonyms: SearchPresentation["synonyms"] = []
  value.synonyms.forEach((row, index) => {
    const words = row.words.map((word) => word.trim()).filter(Boolean)
    const means = row.means.trim()
    if (!words.length && !means) return
    const where = `Synonym row ${index + 1}`
    if (!words.length) throw new Error(`${where}: add the words shoppers type.`)
    if (words.length > 10) throw new Error(`${where}: use up to 10 words.`)
    if (words.some((word) => word.length > 40)) throw new Error(`${where}: keep each word to 40 characters or fewer.`)
    if (!means) throw new Error(`${where}: add what to search for.`)
    synonyms.push({ words, means })
  })
  return { ...value, synonyms }
}

/** Admin > Search: the search field, its Try chips, synonyms and the help link. */
export function SearchPresentationEditor({ storefront = "" }: { storefront?: string }) {
  const state = useSettings<SearchPresentation>("search", tidySearch)
  const value = state.value
  const set = (patch: Partial<SearchPresentation>) => state.setValue((current) => current ? { ...current, ...patch } : current)
  return <Frame title="Search" description="The search field in the header, its Try suggestions, words shoppers use for the same thing, and the link shown when nothing matches." state={state}>
    {value && <>
      {storefront ? <div><a className="text-ui-fg-interactive underline" href={`${storefront}/search/`} target="_blank" rel="noreferrer noopener">Try it on the store</a></div> : null}
      <div className="md:max-w-md">
        <Field label="Placeholder" value={value.placeholder} max={60} onChange={(placeholder) => set({ placeholder })} hint="The grey text in the empty search field." />
      </div>
      <div className="grid gap-4">
        <Heading level="h2">Try suggestions</Heading>
        <Chips id="search-suggest-women" label="Try suggestions (Women)" items={value.suggest_women} onChange={(suggest_women) => set({ suggest_women })} />
        <Chips id="search-suggest-men" label="Try suggestions (Men)" items={value.suggest_men} onChange={(suggest_men) => set({ suggest_men })} />
        <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
          <Text size="small">Suggestions show as Try, never as Popular, because they are chosen here, not measured.</Text>
        </div>
      </div>
      <div className="grid gap-3">
        <Heading level="h2">Synonyms</Heading>
        <Text size="small" className="text-ui-fg-subtle">Words shoppers type for the same thing, including misspellings and Bangla. Separate words with commas, up to 10 per row.</Text>
        <div className="hidden gap-2 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <Text size="xsmall" weight="plus" className="text-ui-fg-muted">When shoppers type</Text>
          <Text size="xsmall" weight="plus" className="text-ui-fg-muted">Search for</Text>
          <span className="w-16" />
        </div>
        {value.synonyms.map((row, index) => <SynonymRow key={index} index={index} row={row} onChange={(next) => set({ synonyms: value.synonyms.map((item, i) => i === index ? next : item) })} onRemove={() => set({ synonyms: value.synonyms.filter((_, i) => i !== index) })} />)}
        <div><Button variant="secondary" disabled={value.synonyms.length >= SYNONYMS_MAX} onClick={() => set({ synonyms: [...value.synonyms, { words: [], means: "" }] })}>Add synonym</Button></div>
      </div>
      <div className="grid gap-4">
        <Heading level="h2">Help link when nothing matches</Heading>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Help link label" value={value.help_label} max={60} onChange={(help_label) => set({ help_label })} />
          <Field label="Help link URL" value={value.help_href} max={500} onChange={(help_href) => set({ help_href })} hint="For example /contact/. Leave both fields blank to hide it." />
        </div>
      </div>
    </>}
  </Frame>
}
