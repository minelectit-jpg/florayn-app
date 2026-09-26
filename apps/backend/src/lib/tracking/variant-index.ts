import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { CATALOG_MODULE } from "../../modules/catalog"
import { CASE_TYPES } from "../../modules/catalog/data/case-types"
import {
  blankAvailability,
  blankKey,
  isAvailable,
  type StockMap,
  variantAvailability,
  variantKey,
} from "../stock-availability"
import { getState, setState, trackingDb, withTransaction } from "./db"
import type { TrackingConfig } from "./settings"

/**
 * The variant index (TRACKING.md 8.1): the backend's own list of every real
 * variant id with the BDT price checkout charges, its case type, device, stock
 * and whether it is sellable. Ingest replaces browser-reported prices with it
 * and counts ids it does not know (B5); the catalog feed and its image copies
 * start from the same resolution, so an ad item and an ad event always agree
 * on id and price.
 *
 * tracking_variant is a raw table written through the PG_CONNECTION knex, a
 * documented exception to AGENTS.md "no raw SQL" (lib/tracking/db.ts): the
 * rebuild upserts 13k rows and deletes the ones no longer seen in one
 * transaction, which module services cannot express. Every statement uses
 * bindings.
 */

export type PriceGroupRef = { label?: string; price: number; devices: string[] }
export type CaseTypeRef = {
  slug: string
  name: string
  description: string | null
  price: number | null
  price_groups: PriceGroupRef[] | null
  is_active: boolean
}
export type DeviceRef = { slug: string; name: string; family: string; is_active: boolean }
/** Case types and devices by NAME, the value a variant's option carries. */
export type CatalogRefs = { caseTypes: Map<string, CaseTypeRef>; devices: Map<string, DeviceRef> }

export type ResolvedVariant = {
  variantId: string
  productId: string
  handle: string
  sku: string | null
  kind: "case" | "regular"
  caseTypeName: string | null
  deviceName: string | null
  caseType: CaseTypeRef | null
  device: DeviceRef | null
  /** BDT, major units, what checkout charges; null when the variant has no base BDT price. */
  price: number | null
  inStock: boolean
  sellable: boolean
}

export type VariantIndexState = { built_at: string; count: number; sellable: number }
export type IndexedVariant = {
  price: number | null
  sellable: boolean
  handle: string
  case_type: string | null
  device: string | null
}

type IndexRow = {
  variant_id: string
  product_id: string
  handle: string
  sku: string | null
  case_type: string | null
  device: string | null
  price: number | null
  in_stock: boolean
  sellable: boolean
}

export const PRODUCT_BATCH = 25
const WRITE_CHUNK = 1000
const CHECK_EVERY_MS = 60_000

/** The rebuildCards read shape, plus what the index needs; the feed and images extend it. */
export const PRODUCT_BASE_FIELDS = [
  "id",
  "handle",
  "status",
  "options.id",
  "options.title",
  "variants.id",
  "variants.sku",
  "variants.options.option_id",
  "variants.options.value",
  "variants.prices.amount",
  "variants.prices.currency_code",
  "variants.prices.rules_count",
  "variants.prices.price_list_id",
  "variants.prices.min_quantity",
  "variants.prices.max_quantity",
]

const seedGroupsBySlug = new Map<string, PriceGroupRef[] | null>(
  CASE_TYPES.map((c) => [c.slug, (c.price_groups as PriceGroupRef[] | undefined) ?? null])
)

const lc = (value: unknown) => String(value ?? "").trim().toLowerCase()

/**
 * Case types and devices from the catalog module. price_groups falls back to
 * the seed's groups while the DB column is null, as /store/case-types does.
 * A device name held by an active and an inactive device resolves to the
 * active one, as the storefront's device list (active only) does.
 */
export async function loadCatalogRefs(container: any): Promise<CatalogRefs> {
  const catalog: any = container.resolve(CATALOG_MODULE)
  const [caseTypes, devices] = await Promise.all([
    catalog.listCaseTypes({}, { take: 1000 }),
    catalog.listDevices({}, { take: 1000 }),
  ])
  const caseTypeMap = new Map<string, CaseTypeRef>()
  for (const c of caseTypes ?? []) {
    if (!c?.name || !c?.slug) continue
    caseTypeMap.set(c.name, {
      slug: c.slug,
      name: c.name,
      description: typeof c.description === "string" ? c.description : null,
      price: Number.isFinite(Number(c.price)) ? Number(c.price) : null,
      price_groups: Array.isArray(c.price_groups) ? c.price_groups : seedGroupsBySlug.get(c.slug) ?? null,
      is_active: c.is_active !== false,
    })
  }
  const deviceMap = new Map<string, DeviceRef>()
  const ordered = [...(devices ?? [])].sort((a: any, b: any) => Number(a?.is_active !== false) - Number(b?.is_active !== false))
  for (const d of ordered) {
    if (!d?.name || !d?.slug) continue
    deviceMap.set(d.name, { slug: d.slug, name: d.name, family: String(d.family ?? ""), is_active: d.is_active !== false })
  }
  return { caseTypes: caseTypeMap, devices: deviceMap }
}

/** Reads every product in id order, 25 at a time (the rebuildCards shape). */
export async function forEachProductBatch(
  container: any,
  fields: string[],
  filters: Record<string, unknown> | undefined,
  fn: (products: any[]) => Promise<void> | void
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  for (let skip = 0; ; skip += PRODUCT_BATCH) {
    const { data } = await query.graph({
      entity: "product",
      ...(filters ? { filters } : {}),
      fields,
      pagination: { take: PRODUCT_BATCH, skip, order: { id: "ASC" } },
    })
    const products = Array.isArray(data) ? data : []
    await fn(products)
    if (products.length < PRODUCT_BATCH) break
  }
}

/** The product's Device and Case Type option ids (titles compared case-insensitively). */
export function productOptionIds(product: any): { device?: string; caseType?: string } {
  const find = (title: string) => (product?.options ?? []).find((o: any) => lc(o?.title) === title)?.id
  return { device: find("device"), caseType: find("case type") }
}

/** A regular (non-case) product has neither a Device nor a Case Type option. */
export function isRegularProduct(product: any): boolean {
  const ids = productOptionIds(product)
  return !ids.device && !ids.caseType
}

/**
 * The variant's base BDT price in major units: the plain price with no rules,
 * price list or quantity band, which is what checkout charges. Null when none.
 */
export function basePrice(variant: any): number | null {
  const price = (variant?.prices ?? []).find((p: any) => lc(p?.currency_code) === "bdt" && !p.rules_count
    && !p.price_list_id && p.min_quantity == null && p.max_quantity == null)
  const amount = Number(price?.amount)
  return price && Number.isFinite(amount) ? amount : null
}

/** What a device costs in a case type: its price group, else the flat price (lib/reprice-case-type.ts). */
export function expectedCasePrice(caseType: CaseTypeRef, deviceSlug: string): number | null {
  const group = caseType.price_groups?.find((g) => Array.isArray(g?.devices) && g.devices.includes(deviceSlug))
  return group ? Number(group.price) : caseType.price
}

/**
 * Case type, device, price, stock and sellable for one variant. Sellable =
 * published product, an active device and case type (catalog module) for a
 * case product, and a BDT price above zero. Stock reads the maps the way the
 * buy box does (lib/stock-availability.ts).
 */
export function resolveVariant(
  product: any,
  variant: any,
  refs: CatalogRefs,
  stock: { blank: StockMap; variant: StockMap }
): ResolvedVariant {
  const ids = productOptionIds(product)
  const optionValue = (optionId?: string) => {
    if (!optionId) return null
    const value = (variant?.options ?? []).find((o: any) => o?.option_id === optionId)?.value
    return typeof value === "string" && value ? value : null
  }
  const published = product?.status === "published"
  const price = basePrice(variant)
  const priced = price !== null && price > 0
  const base = {
    variantId: String(variant.id),
    productId: String(product.id),
    handle: String(product.handle ?? ""),
    sku: typeof variant?.sku === "string" && variant.sku ? variant.sku : null,
    price,
  }
  if (!ids.device && !ids.caseType) {
    return {
      ...base, kind: "regular", caseTypeName: null, deviceName: null, caseType: null, device: null,
      inStock: isAvailable(stock.variant, variantKey(base.variantId)),
      sellable: published && priced,
    }
  }
  const caseTypeName = optionValue(ids.caseType)
  const deviceName = optionValue(ids.device)
  const caseType = caseTypeName ? refs.caseTypes.get(caseTypeName) ?? null : null
  const device = deviceName ? refs.devices.get(deviceName) ?? null : null
  return {
    ...base, kind: "case", caseTypeName, deviceName, caseType, device,
    inStock: caseTypeName && deviceName ? isAvailable(stock.blank, blankKey(caseTypeName, deviceName)) : false,
    sellable: published && priced && Boolean(caseType?.is_active) && Boolean(device?.is_active),
  }
}

/**
 * Whether a resolved variant belongs in the catalog feed's scope (8.2):
 * sellable, its case type not excluded and, when an include list is set, in
 * it. The include/exclude lists are case type slugs, so they only narrow case
 * products; regular products are always in scope.
 */
export function inFeedScope(resolved: ResolvedVariant, catalog: TrackingConfig["catalog"]): boolean {
  if (!resolved.sellable) return false
  if (resolved.kind === "regular") return true
  const slug = resolved.caseType?.slug
  if (!slug) return false
  if (catalog.exclude_case_types.includes(slug)) return false
  return !catalog.include_case_types.length || catalog.include_case_types.includes(slug)
}

// ---------------------------------------------------------------- rebuild

const UPSERT_SQL = `insert into tracking_variant (variant_id, product_id, handle, sku, case_type, device, price, in_stock, sellable, updated_at)
select r.variant_id, r.product_id, r.handle, r.sku, r.case_type, r.device, r.price, r.in_stock, r.sellable, now()
from jsonb_to_recordset(?::jsonb) as r(variant_id text, product_id text, handle text, sku text, case_type text, device text, price numeric, in_stock boolean, sellable boolean)
on conflict (variant_id) do update set product_id = excluded.product_id, handle = excluded.handle, sku = excluded.sku,
  case_type = excluded.case_type, device = excluded.device, price = excluded.price, in_stock = excluded.in_stock,
  sellable = excluded.sellable, updated_at = now()
where (tracking_variant.product_id, tracking_variant.handle, tracking_variant.sku, tracking_variant.case_type,
  tracking_variant.device, tracking_variant.price, tracking_variant.in_stock, tracking_variant.sellable)
  is distinct from (excluded.product_id, excluded.handle, excluded.sku, excluded.case_type, excluded.device,
  excluded.price, excluded.in_stock, excluded.sellable)`

const DELETE_UNSEEN_SQL = `delete from tracking_variant t
where not exists (select 1 from jsonb_array_elements_text(?::jsonb) as seen(id) where seen.id = t.variant_id)`

/**
 * Rebuilds tracking_variant from the products: upserts every variant (rows
 * that did not change are not rewritten), deletes ids no longer present and
 * writes tracking_state `variant_index` { built_at, count, sellable }, all in
 * one transaction. built_at is the START of the read, so a product change
 * that lands while this runs (catalog:stale newer than built_at) triggers the
 * next rebuild.
 */
export async function rebuildVariantIndex(container: any): Promise<VariantIndexState> {
  const builtAt = new Date(Date.now()).toISOString()
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [refs, blank] = await Promise.all([loadCatalogRefs(container), blankAvailability(query)])
  const rows: IndexRow[] = []
  const seen = new Set<string>()
  await forEachProductBatch(container, PRODUCT_BASE_FIELDS, undefined, async (products) => {
    for (const product of products) {
      if (!product?.id) continue
      // Only published regular products have stock the shop shows; the few
      // regular products are read one by one, exactly as /store/stock?handle=.
      const variantStock = isRegularProduct(product) && product.status === "published" && product.handle
        ? await variantAvailability(query, product.handle)
        : {}
      for (const variant of product.variants ?? []) {
        if (!variant?.id || seen.has(variant.id)) continue
        seen.add(variant.id)
        const r = resolveVariant(product, variant, refs, { blank, variant: variantStock })
        rows.push({
          variant_id: r.variantId, product_id: r.productId, handle: r.handle, sku: r.sku,
          case_type: r.caseTypeName, device: r.deviceName, price: r.price,
          in_stock: product.status === "published" ? r.inStock : false, sellable: r.sellable,
        })
      }
    }
  })
  const state: VariantIndexState = { built_at: builtAt, count: rows.length, sellable: rows.filter((r) => r.sellable).length }
  await withTransaction(container, async (trx) => {
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      await trx.raw(UPSERT_SQL, [JSON.stringify(rows.slice(i, i + WRITE_CHUNK))])
    }
    await trx.raw(DELETE_UNSEEN_SQL, [JSON.stringify([...seen])])
    await setState(trx, "variant_index", state)
  })
  // Let this process pick the new build up on its next lookup.
  if (indexCache) indexCache.checkedAt = 0
  return state
}

export async function readVariantIndexState(container: any): Promise<VariantIndexState | null> {
  return getState<VariantIndexState>(trackingDb(container), "variant_index")
}

// ---------------------------------------------------------------- lookup

let indexCache: { checkedAt: number; builtAt: string | null; map: Map<string, IndexedVariant> } | null = null
let refreshing: Promise<Map<string, IndexedVariant>> | null = null

async function loadIndex(container: any): Promise<Map<string, IndexedVariant>> {
  const db = trackingDb(container)
  const state = await getState<VariantIndexState>(db, "variant_index")
  const builtAt = state?.built_at ?? null
  if (indexCache && indexCache.builtAt === builtAt) {
    indexCache.checkedAt = Date.now()
    return indexCache.map
  }
  const result: any = await db.raw("select variant_id, handle, case_type, device, price, sellable from tracking_variant")
  const map = new Map<string, IndexedVariant>()
  for (const row of result?.rows ?? []) {
    const price = row.price === null || row.price === undefined ? null : Number(row.price)
    map.set(row.variant_id, {
      price: price !== null && Number.isFinite(price) ? price : null,
      sellable: row.sellable === true,
      handle: row.handle,
      case_type: row.case_type ?? null,
      device: row.device ?? null,
    })
  }
  indexCache = { checkedAt: Date.now(), builtAt, map }
  return map
}

async function currentIndex(container: any): Promise<Map<string, IndexedVariant>> {
  if (indexCache && Date.now() - indexCache.checkedAt < CHECK_EVERY_MS) return indexCache.map
  if (!refreshing) {
    const pending = loadIndex(container).catch((error) => {
      // Keep answering from the last copy while the database is unreachable,
      // and wait a full interval before trying again.
      if (indexCache) {
        indexCache.checkedAt = Date.now()
        return indexCache.map
      }
      throw error
    })
    refreshing = pending
    pending.then(() => { refreshing = null }, () => { refreshing = null })
  }
  return refreshing
}

/**
 * Index facts for the given variant ids (unknown ids are absent). Served from
 * an in-process copy of the whole table, reloaded only when
 * `variant_index.built_at` changes, which is checked at most every 60 s.
 * Before the first build every id is unknown, so ingest sends nothing (8.1).
 */
export async function lookupVariants(container: any, ids: readonly string[]): Promise<Map<string, IndexedVariant>> {
  const index = await currentIndex(container)
  const found = new Map<string, IndexedVariant>()
  for (const id of ids) {
    const entry = typeof id === "string" ? index.get(id) : undefined
    if (entry) found.set(id, entry)
  }
  return found
}
