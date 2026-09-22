import { Heading, Text } from "@medusajs/ui"
import { useState } from "react"
import { selectClass } from "./shared"

export default function ContentPreview({ name, description, variants }: { name: string; description: string; variants: { label: string; images: string[]; price?: number | null }[] }) {
  const [index, setIndex] = useState(0)
  const selected = variants[Math.min(index, Math.max(0, variants.length - 1))]
  const [imageIndex, setImageIndex] = useState(0)
  const images = selected?.images ?? []
  return <section aria-label="Product content preview" className="grid gap-5 rounded-xl border p-5 md:grid-cols-2">
    <div><div className="flex aspect-square items-center justify-center rounded-lg bg-ui-bg-subtle">{images.length ? <img className="h-full w-full object-contain" src={images[Math.min(imageIndex, images.length - 1)]} alt={name} /> : <Text>No image added</Text>}</div><div className="mt-3 flex flex-wrap gap-2">{images.map((url, i) => <button key={`${url}-${i}`} type="button" aria-label={`Preview image ${i + 1}`} aria-pressed={i === imageIndex} onClick={() => setImageIndex(i)} className="rounded border p-1"><img src={url} alt="" loading="lazy" className="h-14 w-12 object-contain" /></button>)}</div></div>
    <div className="grid content-start gap-4"><Text size="xsmall" className="text-ui-fg-muted">PRIVATE CONTENT PREVIEW</Text><Heading level="h2">{name}</Heading><Text className="whitespace-pre-wrap">{description || "No description added yet."}</Text><select aria-label="Preview variant" className={selectClass} value={Math.min(index, Math.max(0, variants.length - 1))} onChange={(e) => { setIndex(Number(e.target.value)); setImageIndex(0) }}>{variants.map((v, i) => <option key={i} value={i}>{v.label}</option>)}</select><Heading level="h3">{selected?.price == null ? "Price set by case type" : `${selected.price.toLocaleString("en-BD", { minimumFractionDigits: 2 })} BDT`}</Heading><Text size="small" className="text-ui-fg-muted">Review the product content here. This preview stays inside Admin; the storefront uses the shared product page layout.</Text></div>
  </section>
}
