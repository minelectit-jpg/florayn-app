import { Button, Input, Select, Text, toast } from "@medusajs/ui"
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react"

export type Variant = { id: string; title: string; sku: string | null; caseType: string | null; device: string | null; caseTypeSlug: string | null; deviceSlug: string | null; image: string | null; images: string[]; price: number | null; options: Record<string, string>; inventory: { id: string; shared: boolean; levels: { location_id: string; stocked: number; reserved: number }[] }[] }
export type Product = { id: string; handle: string; title: string; form: string; status: string; thumbnail: string | null; description: string; images: string[]; options: { title: string; values: string[] }[]; caseTypes: string[]; devices: string[]; variants: Variant[] }
export type Detail = { slug: string; name: string; theme: string | null; kind: "design" | "regular"; collection: { id: string; title: string } | null; products: Product[] }
export type CatalogOption = { slug: string; name: string; family?: string; price?: number }
// Use Medusa's themed popup: Windows native option menus can inherit light
// text from dark mode while painting their own white background.
export function ManagerSelect({ value, onValueChange, children, id, "aria-label": label }: {
  value: string | number
  onValueChange: (value: string) => void
  children: ReactNode
  id?: string
  "aria-label"?: string
}) {
  const options = Children.toArray(children).filter(isValidElement<{ value: string | number; children: ReactNode }>)
  const empty = "__manager_empty__"
  return <Select value={String(value) || empty} onValueChange={(next) => onValueChange(next === empty ? "" : next)}>
    <Select.Trigger id={id} aria-label={label} className="w-full"><Select.Value /></Select.Trigger>
    <Select.Content>{options.map((option) => <Select.Item key={String(option.props.value)} value={String(option.props.value) || empty}>{option.props.children}</Select.Item>)}</Select.Content>
  </Select>
}
export const slugify = (s: string) => s.toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

export async function api(path: string, init?: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch(path, { credentials: "include", ...init, signal: controller.signal, headers: { "content-type": "application/json", ...init?.headers } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`)
    return data
  } catch (error: any) {
    if (error.name === "AbortError") throw new Error("The request timed out. Refresh the product list before retrying; your save may have completed.")
    throw error
  } finally { clearTimeout(timer) }
}
export const post = (path: string, data: unknown) => api(path, { method: "POST", body: JSON.stringify(data) })

export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
}

export function Gallery({ images, onChange, slug, disabled = false, onBusy }: { images: string[]; onChange: (urls: string[]) => void; slug: string; disabled?: boolean; onBusy?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const lock = useRef(false)
  async function upload(files: File[]) {
    if (lock.current || !files.length) return
    if (files.some((f) => !["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(f.type) || f.size > 15 * 1024 * 1024)) { toast.error("Choose JPG, PNG, WebP, AVIF or GIF images up to 15 MB each."); return }
    if (images.length + files.length > 30) { toast.error("Use up to 30 images per variant."); return }
    lock.current = true
    setBusy(true)
    onBusy?.(true)
    const next = [...images]
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading ${i + 1} of ${files.length}`)
        const file = files[i]
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(",")[1])
          reader.onerror = () => reject(new Error("Could not read this image."))
          reader.readAsDataURL(file)
        })
        const result = await post("/admin/designs/upload", { designSlug: slug || "new-product", caseTypeSlug: "gallery", deviceSlug: "product", index: next.length + 1, filename: file.name, mimeType: file.type, contentBase64: base64 })
        next.push(result.url)
        onChange([...next])
      }
    } catch (error: any) { toast.error(`${error.message} Successfully uploaded images are kept.`) }
    finally { lock.current = false; setBusy(false); onBusy?.(false); setProgress("") }
  }
  return <div className="grid gap-3">
    <div className="flex flex-wrap gap-2">{images.map((url, i) => <div key={`${url}-${i}`} className="rounded-lg border border-ui-border-base p-1.5">
      <img src={url} alt={`Product image ${i + 1}`} loading="lazy" className="h-24 w-20 rounded object-contain" />
      <div className="mt-1 flex gap-1">
        <Button size="small" variant="transparent" aria-label={`Move image ${i + 1} earlier`} disabled={disabled || busy || i === 0} onClick={() => { const next = [...images]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next) }}>←</Button>
        <Button size="small" variant="transparent" aria-label={`Remove image ${i + 1}`} disabled={disabled || busy} onClick={() => onChange(images.filter((_, n) => n !== i))}>×</Button>
      </div>
    </div>)}</div>
    <input aria-label="Upload product images" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple disabled={disabled || busy} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files) }} />
    <Text size="xsmall" className="text-ui-fg-muted" role="status">{progress || "The first image is the cover. Upload replacements, then remove the old images and save."}</Text>
  </div>
}

export function CatalogCreate({ onCreated }: { onCreated: () => void }) {
  const [kind, setKind] = useState("")
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [family, setFamily] = useState("iphone")
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  async function save() {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      if (!name.trim() || (kind === "case" && (!price.trim() || !Number.isFinite(Number(price)) || Number(price) < 0))) throw new Error("Enter a name and a valid price where required.")
      await post(kind === "case" ? "/admin/case-types" : "/admin/devices", kind === "case" ? { name, price: Number(price) } : { name, family })
      toast.success("Created. You can select it now."); setKind(""); setName(""); setPrice(""); onCreated()
    } catch (error: any) { toast.error(error.message) } finally { lock.current = false; setBusy(false) }
  }
  return <div className="rounded-lg border border-dashed border-ui-border-base p-3">
    {!kind ? <div className="flex gap-2"><Button size="small" variant="secondary" onClick={() => setKind("case")}>New case type</Button><Button size="small" variant="secondary" onClick={() => setKind("device")}>New model</Button></div> : <div className="grid gap-2">
      <Input aria-label="New catalog name" placeholder={kind === "case" ? "Case type name" : "Model name"} value={name} onChange={(e) => setName(e.target.value)} />
      {kind === "case" ? <Input aria-label="Shared case type price" type="number" min={0} placeholder="Price for every design (BDT)" value={price} onChange={(e) => setPrice(e.target.value)} /> : <ManagerSelect aria-label="Model family" value={family} onValueChange={setFamily}>{["iphone", "samsung", "airpods", "watch", "wallet"].map((f) => <option key={f} value={f}>{f}</option>)}</ManagerSelect>}
      <div className="flex gap-2"><Button size="small" isLoading={busy} onClick={save}>Create</Button><Button size="small" variant="secondary" disabled={busy} onClick={() => setKind("")}>Cancel</Button></div>
    </div>}
  </div>
}
