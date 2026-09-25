import { Button, Container, Heading, Input, Label, Switch, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { DELIVERY_ICONS, validateBuyBoxPresentation, validateDeliveryPresentation, validateFooterPresentation, type BuyBoxPresentation, type DeliveryPresentation, type FooterPresentation } from "../../lib/storefront-presentation"
import { contentApi } from "./menu-editor"
import { ManagerSelect, useUnsaved } from "./product-manager/shared"

const VALIDATORS = { footer: validateFooterPresentation, delivery: validateDeliveryPresentation, buy_box: validateBuyBoxPresentation }

function useSettings<T>(section: "footer" | "delivery" | "buy_box") {
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
      const settings = VALIDATORS[section](value)
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
