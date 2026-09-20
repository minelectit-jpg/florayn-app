import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Tag } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

type Settings = {
  heading: string
  description: string
  delivery_note: string
  support_phone: string
  support_label: string
  show_order_note: boolean
}

const CheckoutPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError("")
    fetch("/admin/checkout-settings", {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load checkout settings.")
        const data = await response.json()
        setSettings(data.settings)
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reload])

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current)
    setErrors((current) => ({ ...current, [key]: "", form: "" }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!settings || saving) return
    setSaving(true)
    setErrors({})
    try {
      const response = await fetch("/admin/checkout-settings", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setErrors(data.errors ?? { form: data.message ?? "Could not save settings. Please try again." })
        return
      }
      setSettings(data.settings)
      toast.success("Checkout settings saved")
    } catch {
      setErrors({ form: "Could not reach the server. Your edits are still here; please try again." })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Container><Text>Loading checkout settings...</Text></Container>
  if (loadError || !settings) {
    return <Container className="space-y-4">
      <Text role="alert">{loadError || "Could not load checkout settings."}</Text>
      <Button variant="secondary" onClick={() => setReload((value) => value + 1)}>Try again</Button>
    </Container>
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Container>
        <div className="mb-6 space-y-1">
          <Heading>Checkout</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Edit the delivery message, help contact and optional fields on the new storefront checkout.
          </Text>
        </div>
        <form onSubmit={save} className="space-y-6">
          <fieldset disabled={saving} className="grid gap-5 lg:grid-cols-2">
            <SettingField name="heading" label="Page heading" error={errors.heading}>
              <Input id="heading" value={settings.heading} maxLength={80} required
                aria-invalid={Boolean(errors.heading)} aria-describedby={errors.heading ? "heading-error" : undefined}
                onChange={(event) => update("heading", event.target.value)} />
            </SettingField>
            <SettingField name="description" label="Introduction" error={errors.description}>
              <Input id="description" value={settings.description} maxLength={240}
                aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "description-error" : undefined}
                onChange={(event) => update("description", event.target.value)} />
            </SettingField>
            <SettingField name="delivery_note" label="Delivery message (optional)" error={errors.delivery_note}>
              <Textarea id="delivery_note" value={settings.delivery_note} maxLength={240} rows={3}
                aria-invalid={Boolean(errors.delivery_note)} aria-describedby="delivery_note-help delivery_note-error"
                onChange={(event) => update("delivery_note", event.target.value)} />
              <Text id="delivery_note-help" size="small" className="text-ui-fg-subtle">
                Add a delivery estimate only when you can fulfil it. Leave blank to hide this message.
              </Text>
            </SettingField>
            <div className="space-y-5">
              <SettingField name="support_phone" label="Help phone number (optional)" error={errors.support_phone}>
                <Input id="support_phone" type="tel" value={settings.support_phone} maxLength={32}
                  placeholder="+8801310007055" aria-invalid={Boolean(errors.support_phone)}
                  aria-describedby="support_phone-help support_phone-error"
                  onChange={(event) => update("support_phone", event.target.value)} />
                <Text id="support_phone-help" size="small" className="text-ui-fg-subtle">
                  International format. Leave blank to hide the call link.
                </Text>
              </SettingField>
              <SettingField name="support_label" label="Help link label" error={errors.support_label}>
                <Input id="support_label" value={settings.support_label} maxLength={60} required
                  aria-invalid={Boolean(errors.support_label)} aria-describedby={errors.support_label ? "support_label-error" : undefined}
                  onChange={(event) => update("support_label", event.target.value)} />
              </SettingField>
            </div>
            <div className="flex items-center gap-3 lg:col-span-2">
              <Switch id="show_order_note" checked={settings.show_order_note}
                onCheckedChange={(value) => update("show_order_note", value)} />
              <div>
                <Label htmlFor="show_order_note">Allow an optional delivery note</Label>
                <Text size="small" className="text-ui-fg-subtle">Customers can leave directions or a delivery instruction.</Text>
                {errors.show_order_note ? <Text role="alert" className="text-ui-fg-error">{errors.show_order_note}</Text> : null}
              </div>
            </div>
          </fieldset>
          {errors.form ? <Text role="alert" className="text-ui-fg-error">{errors.form}</Text> : null}
          <Button type="submit" isLoading={saving} disabled={saving}>Save checkout settings</Button>
        </form>
      </Container>
      <Container className="space-y-4">
        <Heading level="h2">Payment and delivery</Heading>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="green">Cash on delivery</Badge>
          <Text size="small" className="text-ui-fg-subtle">The connected checkout payment method.</Text>
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          Online payments need a connected payment provider before they can be offered at checkout.
          Delivery charges and discounts are calculated on the server from the customer’s cart and district.
        </Text>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link className="text-ui-fg-interactive" to="/bundles">Bundle discounts and free delivery threshold</Link>
          <Link className="text-ui-fg-interactive" to="/settings/locations">Locations and delivery options</Link>
        </div>
      </Container>
    </div>
  )
}

function SettingField({ name, label, error, children }: {
  name: string
  label: string
  error?: string
  children: React.ReactNode
}) {
  return <div className="space-y-2">
    <Label htmlFor={name}>{label}</Label>
    {children}
    <Text id={`${name}-error`} role={error ? "alert" : undefined} size="small" className={error ? "text-ui-fg-error" : "hidden"}>
      {error || ""}
    </Text>
  </div>
}

export const config = defineRouteConfig({ label: "Checkout", icon: Tag })

export default CheckoutPage
