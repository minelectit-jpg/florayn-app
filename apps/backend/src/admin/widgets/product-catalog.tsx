import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Text } from "@medusajs/ui"

/**
 * A product here is one design in one case type, and its variants are devices.
 * The admin product page shows the combined title, so this widget spells the
 * two halves out and reminds whoever is editing what a variant means.
 */
const ProductCatalogWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const metadata = (data.metadata ?? {}) as Record<string, string | undefined>

  const rows: [string, string | undefined][] = [
    ["Design", metadata.design_name],
    ["Case type", metadata.case_type_name],
    ["Theme", metadata.theme],
    ["Artist", metadata.artist],
  ]

  if (!metadata.design_slug && !metadata.case_type_slug) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Catalog</Heading>
        <Badge size="2xsmall">{data.variants?.length ?? 0} devices</Badge>
      </div>

      <div className="px-6 py-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <Text size="small" className="text-ui-fg-subtle">
                {label}
              </Text>
              <Text size="small">{value ?? "-"}</Text>
            </div>
          ))}
        </div>

        <Text size="xsmall" className="text-ui-fg-muted pt-4">
          Variants are devices. To sell this artwork in another construction,
          create a separate product for that case type rather than adding an
          option here.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default ProductCatalogWidget
