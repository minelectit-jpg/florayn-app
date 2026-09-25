import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ListBullet } from "@medusajs/icons"
import { Button, Container, Text, toast } from "@medusajs/ui"
import { useState } from "react"

import MenuEditor, { contentApi } from "../../components/menu-editor"
import { NavigationPresentationEditor } from "../../components/storefront-presentation-editor"

/**
 * Admin > Navigation (still at /mega-menu): the phone menu and the desktop
 * bar, one menu per shopping mode, then the settings both share. Links are
 * entered plain ("/shop/…"); on the Men site the storefront adds /men itself,
 * so the same link works in both menus.
 */
const NavigationPage = () => {
  const [audience, setAudience] = useState<"women" | "men">("women")
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(false)

  function switchTo(next: "women" | "men") {
    if (next === audience) return
    if (dirty && !window.confirm("Discard the unsaved changes in this menu?")) return
    setDirty(false)
    setAudience(next)
  }

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
            <Button key={value} size="small" variant={audience === value ? "primary" : "secondary"} onClick={() => switchTo(value)}>
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
        title={audience === "men" ? "Navigation: Men" : "Navigation: Women"}
        description="The phone menu and the desktop bar. Automatic sections fill themselves from Devices, Case types and Collection pages."
        useGroups
        typed
        onDirtyChange={setDirty}
      />
      <div className="mt-3">
        <NavigationPresentationEditor />
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Navigation",
  icon: ListBullet,
})

export default NavigationPage
