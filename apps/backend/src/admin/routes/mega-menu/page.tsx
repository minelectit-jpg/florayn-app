import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ListBullet } from "@medusajs/icons"
import { Button, Container, Text, toast } from "@medusajs/ui"
import { useState } from "react"

import MenuEditor, { contentApi } from "../../components/menu-editor"

/**
 * The header navigation, one per shopping mode. Links are entered plain
 * ("/shop/…"); on the Men site the storefront adds /men itself, so the same
 * link works in both menus.
 */
const MegaMenuPage = () => {
  const [audience, setAudience] = useState<"women" | "men">("women")
  const [version, setVersion] = useState(0)

  async function copyToMen() {
    if (!window.confirm("Start the Men menu as a copy of the Women menu? You can then edit it freely.")) return
    try {
      await contentApi("/admin/content/menu-sections", { method: "POST", body: JSON.stringify({ action: "copy-to-men" }) })
      toast.success("Men menu created from the Women menu.")
      setVersion((v) => v + 1)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Which site" className="flex gap-2">
          {(["women", "men"] as const).map((value) => (
            <Button key={value} size="small" variant={audience === value ? "primary" : "secondary"} onClick={() => setAudience(value)}>
              {value === "women" ? "Women (new.florayn.com)" : "Men (/men)"}
            </Button>
          ))}
        </nav>
        {audience === "men" ? (
          <div className="flex items-center gap-3">
            <Text size="small" className="text-ui-fg-subtle">While the Men menu is empty the Men site shows the Women one.</Text>
            <Button size="small" variant="secondary" onClick={copyToMen}>Copy Women menu</Button>
          </div>
        ) : null}
      </Container>
      <MenuEditor
        key={`${audience}-${version}`}
        menu={audience === "men" ? "primary-men" : "primary"}
        title={audience === "men" ? "Mega menu: Men" : "Mega menu: Women"}
        description="The header navigation. Each menu holds links, and a group heading turns a flat list into a mega-menu column. Enter links without /men; the Men site adds it."
        useGroups
      />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Mega menu",
  icon: ListBullet,
})

export default MegaMenuPage
