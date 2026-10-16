import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { CATALOG_MODULE } from "../modules/catalog"
import { readMockupSettings, setPalette } from "../lib/mockup-settings"
import { colourGalleriesInput, type ColourRow, type ColourSource, type ResolvedColourVariant } from "../lib/phone-colour-input"

/**
 * Phone colour pictures of one design's variants (PHONE_COLOURS.md 3.2). The
 * rows live only in phone_colour_gallery: product.images, product.metadata,
 * variant.metadata and the cards are never touched, so nothing is rebuilt.
 */
export type SavePhoneColoursInput = { designSlug: string; source?: unknown; variants?: unknown }
export type SavePhoneColoursResult = { saved: number; removed: number; warnings: string[] }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const invalid = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message)

export const resolveColourVariants = createStep("resolve-colour-variants", async (input: SavePhoneColoursInput, { container }) => {
  let parsed: ReturnType<typeof colourGalleriesInput>
  try { parsed = colourGalleriesInput({ source: input.source, variants: input.variants }) } catch (error: any) { throw invalid(error.message) }
  const slug = input.designSlug
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // A design's products, found and owned exactly as getDesignDetail does.
  const [{ data: products }, { settings }] = await Promise.all([
    query.graph({ entity: "product", fields: ["id", "handle", "metadata", "variants.id", "variants.metadata"], filters: { handle: [slug, `${slug}-airpods`, `${slug}-watch`, `${slug}-wallet`] } }),
    readMockupSettings(container),
  ])
  const mine = (products ?? []).filter((p: any) => p.metadata?.design_slug === slug || (!p.metadata?.design_slug && p.handle === slug))
  if (!mine.length) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No design found for "${slug}".`)
  const owned = mine.flatMap((p: any) => (p.variants ?? []).map((v: any) => ({
    id: v.id as string,
    productId: p.id as string,
    device: typeof v.metadata?.device_slug === "string" ? v.metadata.device_slug as string : null,
    caseType: typeof v.metadata?.case_type_slug === "string" ? v.metadata.case_type_slug as string : null,
    mainCount: Array.isArray(v.metadata?.images) ? v.metadata.images.length as number : 0,
  })))

  // Names for messages: the models and case types this request mentions.
  const deviceSlugs = new Set<string>()
  const caseSlugs = new Set<string>()
  for (const entry of parsed.variants) {
    if (entry.device) deviceSlugs.add(entry.device)
    if (entry.caseType) caseSlugs.add(entry.caseType)
    const byId = entry.variantId ? owned.find((v) => v.id === entry.variantId) : undefined
    if (byId?.device) deviceSlugs.add(byId.device)
  }
  const catalog = container.resolve(CATALOG_MODULE)
  const [devices, caseTypes] = await Promise.all([
    deviceSlugs.size ? catalog.listDevices({ slug: [...deviceSlugs] }, { select: ["slug", "name"], take: deviceSlugs.size }) : [],
    caseSlugs.size ? catalog.listCaseTypes({ slug: [...caseSlugs] }, { select: ["slug", "name"], take: caseSlugs.size }) : [],
  ])
  const deviceName = (s: string | null) => devices.find((d: any) => d.slug === s)?.name ?? s ?? "This model"
  const caseName = (s: string | null) => caseTypes.find((c: any) => c.slug === s)?.name ?? s ?? "this"

  const used = new Set<string>()
  const warnings: string[] = []
  const variants: ResolvedColourVariant[] = parsed.variants.map((entry, i) => {
    const variant = entry.variantId
      ? owned.find((v) => v.id === entry.variantId)
      : owned.find((v) => v.caseType === entry.caseType && v.device === entry.device)
    if (!variant) {
      if (entry.variantId) throw invalid(`Variant ${i + 1} is not part of this design.`)
      throw invalid(`${deviceName(entry.device ?? null)} has no ${caseName(entry.caseType ?? null)} case in this design. Add the model first.`)
    }
    if (used.has(variant.id)) throw invalid(`${deviceName(variant.device)} ${caseName(variant.caseType)} is listed twice.`)
    used.add(variant.id)
    const set = variant.device ? settings.sets.find((s) => s.device === variant.device) : undefined
    if (!set || !variant.device || !variant.caseType) throw invalid(`${deviceName(variant.device)} has no phone colours. Add them in Mockup sets.`)
    const names = new Map(setPalette(set).map(([colour, name]) => [colour, name]))
    for (const colour of [entry.main, ...Object.keys(entry.galleries)]) {
      if (!names.has(colour)) throw invalid(`${colour} is not a phone colour of ${deviceName(variant.device)}. Choose one from its Mockup set.`)
    }
    for (const [colour, urls] of Object.entries(entry.galleries)) {
      if (variant.mainCount && urls.length !== variant.mainCount) {
        warnings.push(`${deviceName(variant.device)}: ${names.get(colour)} has ${plural(urls.length, "picture")}, the main colour has ${variant.mainCount}. Shoppers switching colour start at picture 1.`)
      }
    }
    return { variantId: variant.id, productId: variant.productId, deviceSlug: variant.device, caseTypeSlug: variant.caseType, main: entry.main, galleries: entry.galleries, replace: entry.replace }
  })
  return new StepResponse({ source: parsed.source, variants, warnings })
})

/**
 * Put these variants' rows back exactly as they were (IDs included): one
 * transaction under the save's per-variant lock (the catalog module).
 */
export const restoreColourRows = (catalog: any, variantIds: string[], snapshot: ColourRow[]): Promise<void> => catalog.restorePhoneColourRows(variantIds, snapshot)

export const upsertColourGalleries = createStep("upsert-colour-galleries", async (input: { source: ColourSource; variants: ResolvedColourVariant[]; warnings: string[] }, { container }) => {
  const catalog = container.resolve(CATALOG_MODULE)
  const variantIds = input.variants.map((v) => v.variantId)
  // One transaction, one save per variant at a time: a failure rolls back
  // everything and its own error surfaces unchanged, and an overlapping save
  // (a console retry, Product Manager and Studio together) waits for this one.
  const { plan, snapshot } = await catalog.savePhoneColourRows(input.variants, input.source)
  const result: SavePhoneColoursResult = { saved: plan.saved, removed: plan.remove.length, warnings: input.warnings }
  return new StepResponse(result, { variantIds, snapshot })
}, async (undo, { container }) => {
  // Only runs when a later step fails (there is none today).
  if (!undo) return
  await restoreColourRows(container.resolve(CATALOG_MODULE), undo.variantIds, undo.snapshot)
})

/** POST /admin/designs/:slug/colours. Idempotent: the same body twice leaves the same rows. */
export const savePhoneColourGalleriesWorkflow = createWorkflow("save-phone-colour-galleries", (input: SavePhoneColoursInput) => {
  const resolved = resolveColourVariants(input)
  const result = upsertColourGalleries(resolved)
  return new WorkflowResponse(result)
})
