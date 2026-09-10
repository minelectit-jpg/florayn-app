import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowDownTray } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"

type Status = {
  wired: number
  placeholder: number
  missing: number
  total: number
  variants_with_images: number
  variants_total: number
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

const WireImagesPage = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<false | "test" | "all">(false)

  function load() {
    setLoading(true)
    api("/admin/wire-images")
      .then((d) => setStatus(d.status))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function run(limit: number) {
    setRunning(limit ? "test" : "all")
    try {
      const d = await api("/admin/wire-images", {
        method: "POST",
        body: JSON.stringify(limit ? { limit } : {}),
      })
      setStatus(d.after)
      toast.success(
        `Wired ${d.result.products} products, ${d.result.variants} variants` +
          (d.result.missingVariants ? `, ${d.result.missingVariants} with no render` : "")
      )
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Product images</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Point every product and device at its render in R2. Runs inside the
          server, so it needs nothing configured. Re-running is safe &mdash; it
          replaces the same URLs.
        </Text>
      </div>

      <div className="px-6 py-4">
        {loading || !status ? (
          <Text size="small">{loading ? "Loading\u2026" : "Could not load status."}</Text>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Badge color={status.wired === status.total ? "green" : "grey"}>
              {status.wired} / {status.total} products wired
            </Badge>
            {status.placeholder > 0 ? (
              <Badge color="orange">{status.placeholder} still placeholder</Badge>
            ) : null}
            {status.missing > 0 ? (
              <Badge color="red">{status.missing} with no thumbnail</Badge>
            ) : null}
            <Badge color={status.variants_with_images === status.variants_total ? "green" : "grey"}>
              {status.variants_with_images} / {status.variants_total} variants
            </Badge>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <Button
          variant="secondary"
          size="small"
          isLoading={running === "test"}
          disabled={!!running}
          onClick={() => run(5)}
        >
          Wire 5 (test)
        </Button>
        <Button
          size="small"
          isLoading={running === "all"}
          disabled={!!running}
          onClick={() => run(0)}
        >
          Wire all products
        </Button>
        <Button variant="transparent" size="small" disabled={!!running} onClick={load}>
          Refresh
        </Button>
        <Text size="xsmall" className="text-ui-fg-subtle">
          The full run touches 525 products and ~13,000 variants and takes a
          few minutes. Leave this tab open until it finishes.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Product images",
  icon: ArrowDownTray,
})

export default WireImagesPage
