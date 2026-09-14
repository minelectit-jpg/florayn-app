import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Phone } from "@medusajs/icons"
import {
  Badge,
  Container,
  Heading,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type Device = {
  id: string
  slug: string
  name: string
  family: string
  is_active: boolean
  sort_order: number
}

const FAMILY_LABEL: Record<string, string> = {
  iphone: "iPhone",
  samsung: "Samsung",
  airpods: "AirPods",
  watch: "Apple Watch",
  wallet: "Wallets",
}
const FAMILY_ORDER = ["iphone", "samsung", "airpods", "watch", "wallet"]

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

const DevicesPage = () => {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  function load() {
    setLoading(true)
    api("/admin/devices")
      .then((d) => setDevices(d.devices ?? []))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function toggle(device: Device, value: boolean) {
    setSaving(device.id)
    // Optimistic: flip locally, roll back on failure.
    setDevices((list) =>
      list.map((d) => (d.id === device.id ? { ...d, is_active: value } : d))
    )
    try {
      await api(`/admin/devices/${device.id}`, {
        method: "POST",
        body: JSON.stringify({ is_active: value }),
      })
      toast.success(`${device.name} ${value ? "shown on" : "hidden from"} the store`)
    } catch (e: any) {
      setDevices((list) =>
        list.map((d) => (d.id === device.id ? { ...d, is_active: !value } : d))
      )
      toast.error(e.message)
    } finally {
      setSaving(null)
    }
  }

  const byFamily = FAMILY_ORDER.map((family) => ({
    family,
    label: FAMILY_LABEL[family] ?? family,
    items: devices.filter((d) => d.family === family),
  })).filter((g) => g.items.length)

  const activeCount = devices.filter((d) => d.is_active).length

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Devices</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Every model the store can sell a case for. Turn one off to hide it from
          the storefront device pickers and the &ldquo;shop by device&rdquo;
          menu &mdash; without touching code. Products keep their other variants.
        </Text>
      </div>

      <div className="px-6 py-3">
        {loading ? (
          <Text size="small">Loading&hellip;</Text>
        ) : (
          <Badge color="grey">
            {activeCount} of {devices.length} shown on the store
          </Badge>
        )}
      </div>

      {byFamily.map((group) => (
        <div key={group.family} className="px-6 py-4">
          <Text
            size="xsmall"
            weight="plus"
            className="mb-3 uppercase tracking-wide text-ui-fg-muted"
          >
            {group.label}
          </Text>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {group.items.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <Text size="small" className="truncate">
                    {device.name}
                  </Text>
                  {!device.is_active ? (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Hidden
                    </Text>
                  ) : null}
                </div>
                <Switch
                  checked={device.is_active}
                  disabled={saving === device.id}
                  onCheckedChange={(v) => toggle(device, v)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Devices",
  icon: Phone,
})

export default DevicesPage
