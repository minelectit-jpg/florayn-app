import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath } from "@medusajs/icons"
import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useState } from "react"

/**
 * "Publish" - a one-click refresh of the live storefront. Content saves already
 * refresh the affected pages automatically; this button is the manual/bulk
 * version (after importing designs, or if a background refresh was missed).
 */
const PublishPage = () => {
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setBusy(true)
    try {
      const res = await fetch("/admin/revalidate-storefront", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      if (body?.configured === false) {
        toast.warning(
          "Storefront URL / secret not set on the backend yet - ask the developer to add STOREFRONT_URL and REVALIDATE_SECRET."
        )
      } else if (body?.ok) {
        toast.success("Storefront refreshed - changes are live now.")
      } else {
        toast.error("Could not reach the storefront to refresh it.")
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Publish</Heading>
        <Button onClick={refresh} isLoading={busy} variant="primary">
          Refresh storefront now
        </Button>
      </div>

      <div className="flex flex-col gap-3 px-6 py-6">
        <Text className="text-ui-fg-subtle">
          The live storefront caches its pages so they load fast. When you save a
          change here - a feature block, a gallery video, a price, a design, a
          &ldquo;We think you&rsquo;ll love&rdquo; pick - the pages it affects are{" "}
          <strong>refreshed automatically</strong>, so customers see it within a
          second or two.
        </Text>
        <Text className="text-ui-fg-subtle">
          Use <strong>Refresh storefront now</strong> if you have imported a batch
          of designs, changed something outside the admin, or just want to be sure
          everything on the live site is up to date. It refreshes every page at
          once.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Publish",
  icon: ArrowPath,
})

export default PublishPage
