import { Button, Container, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { Gallery, post, useUnsaved, type Product } from "./shared"

export default function AddRegularVariant({ product, onSaved, onDirtyChange, onBusyChange }: { product: Product; onSaved: () => void; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void }) {
  const [options, setOptions] = useState<Record<string, string>>({})
  const [sku, setSku] = useState("")
  const [price, setPrice] = useState("")
  const [stock, setStock] = useState("0")
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const lock = useRef(false)
  const dirty = Boolean(sku || price || stock !== "0" || images.length || Object.values(options).some(Boolean))
  useUnsaved(dirty)
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy || uploading); return () => onBusyChange(false) }, [busy, uploading, onBusyChange])
  async function save() {
    if (lock.current || uploading) return
    lock.current = true; setBusy(true)
    try {
      if (!sku.trim() || !price.trim() || !stock.trim()) throw new Error("Enter SKU, price and stock. Zero is allowed.")
      await post(`/admin/products/${product.id}/manager-add-variant`, { options, sku, images, price: Number(price), stock: Number(stock) })
      toast.success("Variant added."); setOptions({}); setSku(""); setPrice(""); setStock("0"); setImages([]); onSaved()
    } catch (error: any) { toast.error(error.message) } finally { lock.current = false; setBusy(false) }
  }
  return <Container className="grid gap-4"><Heading level="h2">Add variant</Heading><Text size="small">Enter an existing or new value for each option. Existing variants keep their IDs, prices and stock.</Text><fieldset disabled={busy || uploading} className="grid gap-4">
    <div className="grid gap-3 md:grid-cols-3">{product.options.map((o, i) => <div key={o.title}><Label htmlFor={`add-option-${i}`}>{o.title}</Label><Input id={`add-option-${i}`} list={`values-${i}`} value={options[o.title] ?? ""} onChange={(e) => setOptions((all) => ({ ...all, [o.title]: e.target.value }))} /><datalist id={`values-${i}`}>{o.values.map((v) => <option key={v} value={v} />)}</datalist></div>)}</div>
    <div className="grid gap-3 md:grid-cols-3"><div><Label htmlFor="add-sku">SKU</Label><Input id="add-sku" value={sku} onChange={(e) => setSku(e.target.value)} /></div><div><Label htmlFor="add-price">Price (BDT)</Label><Input id="add-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div><div><Label htmlFor="add-stock">Stock</Label><Input id="add-stock" type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} /></div></div>
    <Gallery images={images} onChange={setImages} slug={product.handle} onBusy={setUploading} /><div><Button isLoading={busy} onClick={save}>Add variant</Button></div>
  </fieldset></Container>
}
