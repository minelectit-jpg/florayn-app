import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { Gallery, post, useUnsaved, type Product, type Variant } from "./shared"

export default function VariantEditor({ product, variants, slug, onSaved, onClose, onDirtyChange, onBusyChange }: { product: Product; variants: Variant[]; slug: string; onSaved: () => void; onClose: () => void; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void }) {
  const single = variants.length === 1 ? variants[0] : null
  const caseProduct = product.options.some((o) => o.title === "Case Type")
  const [sku, setSku] = useState(single?.sku ?? "")
  const [price, setPrice] = useState(single?.price == null ? "" : String(single.price))
  const [images, setImages] = useState(single?.images ?? [])
  const [replaceImages, setReplaceImages] = useState(Boolean(single))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const lock = useRef(false)
  const dirty = sku !== (single?.sku ?? "") || price !== (single?.price == null ? "" : String(single.price)) || JSON.stringify(images) !== JSON.stringify(single?.images ?? [])
  const inventories = [...new Map(variants.flatMap((v) => v.inventory.map((item) => [item.id, item] as const))).values()]
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [allStock, setAllStock] = useState("")
  const unsaved = dirty || Object.keys(quantities).length > 0
  useUnsaved(unsaved)
  useEffect(() => { onDirtyChange(unsaved); return () => onDirtyChange(false) }, [unsaved, onDirtyChange])
  useEffect(() => { onBusyChange(busy || uploading); return () => onBusyChange(false) }, [busy, uploading, onBusyChange])
  const shared = inventories.some((i) => i.shared)
  async function saveVariants() {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      if (!caseProduct && price.trim() && (!Number.isFinite(Number(price)) || Number(price) < 0)) throw new Error("Enter a valid price.")
      await post(`/admin/products/${product.id}/manager-variants`, { variants: variants.map((v) => ({
        id: v.id, ...(single ? { sku } : {}),
        ...(!caseProduct && price.trim() ? { price: Number(price) } : {}),
        ...(replaceImages ? { images } : {}),
      })) })
      toast.success("Variants saved."); onSaved()
      if (!Object.keys(quantities).length) onClose()
    } catch (error: any) { toast.error(error.message) } finally { lock.current = false; setBusy(false) }
  }
  async function saveStock() {
    if (lock.current) return
    const updates = inventories.flatMap((item) => item.levels.flatMap((level) => {
      const value = quantities[`${item.id}|${level.location_id}`]
      return value === undefined ? [] : [{ id: item.id, location_id: level.location_id, value }]
    }))
    if (!updates.length) return
    if (updates.some((u) => !u.value.trim() || !Number.isSafeInteger(Number(u.value)) || Number(u.value) < 0)) { toast.error("Stock must be a whole number of zero or more."); return }
    lock.current = true; setBusy(true)
    let saved = 0
    try {
      for (const update of updates) {
        await post(`/admin/stock/${update.id}`, { location_id: update.location_id, stocked_quantity: Number(update.value) })
        saved++
        setQuantities((current) => { const next = { ...current }; delete next[`${update.id}|${update.location_id}`]; return next })
      }
      toast.success("Stock saved."); onSaved()
    } catch (error: any) { toast.error(`${saved} stock rows saved. ${error.message}`) }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="grid gap-4 rounded-xl border-2 border-ui-border-interactive p-5" aria-label="Variant editor">
    <div className="flex items-center justify-between"><Heading level="h2">{single ? single.title : `Edit ${variants.length} variants`}</Heading><Button variant="transparent" disabled={busy || uploading} onClick={() => { if (!unsaved || window.confirm("Discard unsaved variant or stock changes?")) onClose() }}>Close</Button></div>
    <fieldset disabled={busy || uploading} className="grid gap-4">
      {single && <div><Label htmlFor="variant-sku">SKU</Label><Input id="variant-sku" value={sku} onChange={(e) => setSku(e.target.value)} /></div>}
      {caseProduct ? <Text size="small">Price is shared by case type across all designs. Use the Case-type pricing tab to change it.</Text> : <div><Label htmlFor="variant-price">{single ? "Price (BDT)" : "Set price for selected variants (optional)"}</Label><Input id="variant-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
      {!single && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replaceImages} onChange={(e) => setReplaceImages(e.target.checked)} />Replace galleries for every selected variant</label>}
      {replaceImages && <Gallery images={images} onChange={setImages} slug={slug} onBusy={setUploading} />}
      <div><Button onClick={saveVariants} isLoading={busy}>Save variant changes</Button></div>
    </fieldset>
    <div className="grid gap-3 border-t pt-4"><Heading level="h3">{shared ? "Shared blank stock" : "Inventory"}</Heading>
      <Text size="small" className="text-ui-fg-subtle">{shared ? "Changing this quantity affects every design using this case type and model. Each shared blank is updated once." : "Stock belongs to the selected variants."} Reserved quantities are shown separately.</Text>
      {!inventories.length && <Text size="small">No inventory is linked to this variant.</Text>}
      {inventories.length > 1 && <div className="flex gap-2"><Input aria-label="Bulk stock quantity" type="number" min={0} step={1} value={allStock} onChange={(e) => setAllStock(e.target.value)} /><Button variant="secondary" disabled={busy || !allStock.trim()} onClick={() => setQuantities(Object.fromEntries(inventories.flatMap((i) => i.levels.map((l) => [`${i.id}|${l.location_id}`, allStock]))))}>Apply to selected stock</Button></div>}
      {inventories.map((item) => <div key={item.id} className="rounded-lg border p-3"><Text size="small">{variants.filter((v) => v.inventory.some((i) => i.id === item.id)).map((v) => v.title).join(", ")}</Text>{!item.levels.length && <Text size="small">No warehouse stock level exists yet.</Text>}{item.levels.map((level) => <div key={level.location_id} className="mt-2 flex flex-wrap items-center gap-3"><Input className="max-w-32" aria-label={`Stock ${item.id} ${level.location_id}`} type="number" min={0} step={1} disabled={busy} value={quantities[`${item.id}|${level.location_id}`] ?? String(level.stocked)} onChange={(e) => setQuantities((current) => ({ ...current, [`${item.id}|${level.location_id}`]: e.target.value }))} /><Text size="small">Reserved: {level.reserved} · Available: {Math.max(0, level.stocked - level.reserved)}</Text></div>)}</div>)}
      <div><Button variant="secondary" isLoading={busy} disabled={!Object.keys(quantities).length || uploading} onClick={saveStock}>{shared ? "Save shared stock" : "Save stock"}</Button></div>
    </div>
  </section>
}
