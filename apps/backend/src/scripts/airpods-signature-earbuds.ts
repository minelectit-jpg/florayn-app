import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  updateInventoryItemsWorkflow,
  updateProductOptionValuesWorkflow,
} from "@medusajs/medusa/core-flows"

import { CATALOG_MODULE } from "../modules/catalog"
import { repriceCaseType } from "../lib/reprice-case-type"
import { revalidateStorefront } from "../lib/revalidate-storefront"

/**
 * One-off, idempotent migration: give AirPods their own "Signature Earbuds"
 * construction, priced apart from the phone Signature (750 vs 1400).
 *
 * Before this, AirPods cases shared the phone "Signature" case type, so they
 * were mispriced at 1400. Structure B makes "Case Type" a variant OPTION whose
 * VALUE is the case type NAME, and the variant carries its own price - so the
 * fix is per-variant, not a field edit:
 *
 *   1. Upsert the signature-earbuds case type (linked to the AirPods devices).
 *   2. Unlink AirPods devices from the phone Signature case type, so the shop's
 *      form-scoped picker stops offering Signature on AirPods.
 *   3. Rename the "Signature" Case Type option value to "Signature Earbuds" IN
 *      PLACE on every AirPods product (updateProductOptionValuesWorkflow keeps
 *      the variant links; deleting/recreating the option would orphan them).
 *   4. Relabel the shared SIG-APD* blanks so the stock map keys on the new name.
 *   5. Reprice the renamed variants to 750 (repriceCaseType rebuilds their cards).
 *   6. Revalidate the storefront caches.
 *
 * Idempotent: re-running renames only values still called "Signature", relabels
 * only blanks still on the old slug, and re-applies the (same) 750 price. Test a
 * single product first with EARBUDS_LIMIT=1; EARBUDS_DRY_RUN=1 logs without
 * writing.
 *
 *   npx medusa exec ./src/scripts/airpods-signature-earbuds.ts
 */
const PHONE_SIGNATURE_SLUG = "signature"
const PHONE_SIGNATURE_NAME = "Signature"
const EARBUDS_SLUG = "signature-earbuds"
const EARBUDS_NAME = "Signature Earbuds"
const EARBUDS_PRICE = 750
const EARBUDS_SKU_CODE = "SIG"
const EARBUDS_DESCRIPTION =
  "Our full-wrap print finish for AirPods cases, with the keychain loop."

export default async function airpodsSignatureEarbuds({ container }: any) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const productModule = container.resolve(Modules.PRODUCT)

  const dryRun = /^(1|true|yes)$/i.test(process.env.EARBUDS_DRY_RUN ?? "")
  const limit = Number(process.env.EARBUDS_LIMIT ?? 0) // 0 = every AirPods product
  const log = (m: string) => logger.info(`[airpods-earbuds] ${m}`)
  log(dryRun ? "DRY RUN - no writes" : "applying changes")

  // --- 1. The AirPods device ids ------------------------------------------
  const devices = await catalog.listDevices(
    {},
    { select: ["id", "slug", "family"], take: 1000 }
  )
  const deviceBySlug = new Map<string, any>(devices.map((d: any) => [d.slug, d]))
  const airpodsDeviceIds = devices
    .filter((d: any) => d.family === "airpods")
    .map((d: any) => d.id)
  const airpodsDeviceIdSet = new Set<string>(airpodsDeviceIds)
  log(`AirPods devices: ${airpodsDeviceIds.length}`)

  // --- 2. Upsert the signature-earbuds case type --------------------------
  const [earbuds] = await catalog.listCaseTypes({ slug: EARBUDS_SLUG })
  if (!earbuds) {
    log(`creating case type "${EARBUDS_NAME}" @ ${EARBUDS_PRICE}`)
    if (!dryRun) {
      await catalog.createCaseTypes([
        {
          slug: EARBUDS_SLUG,
          name: EARBUDS_NAME,
          description: EARBUDS_DESCRIPTION,
          image_url: null,
          sku_code: EARBUDS_SKU_CODE,
          price: EARBUDS_PRICE,
          sort_order: 2,
          is_active: true,
          devices: airpodsDeviceIds,
        },
      ])
    }
  } else {
    log(`case type "${EARBUDS_NAME}" exists; ensuring price + AirPods devices`)
    if (!dryRun) {
      await catalog.updateCaseTypes([
        { id: earbuds.id, price: EARBUDS_PRICE, is_active: true, devices: airpodsDeviceIds },
      ])
    }
  }

  // --- 3. Unlink AirPods devices from the phone Signature case type --------
  const [signature] = await catalog.listCaseTypes(
    { slug: PHONE_SIGNATURE_SLUG },
    { relations: ["devices"] }
  )
  if (signature) {
    const keep = (signature.devices ?? [])
      .map((d: any) => d.id)
      .filter((id: string) => !airpodsDeviceIdSet.has(id))
    const removed = (signature.devices ?? []).length - keep.length
    if (removed > 0) {
      log(`unlinking ${removed} AirPods devices from "Signature"`)
      if (!dryRun) await catalog.updateCaseTypes([{ id: signature.id, devices: keep }])
    } else {
      log(`"Signature" already free of AirPods devices`)
    }
  }

  // --- 4. Rename the Case Type option value on every AirPods product -------
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "handle",
      "metadata",
      "options.id",
      "options.title",
      "options.values.id",
      "options.values.value",
    ],
    pagination: { take: 10000 },
  })
  let airpods = (products as any[])
    .filter((p) => (p.metadata?.form ?? "") === "airpods")
    .sort((a, b) => String(a.handle).localeCompare(String(b.handle)))
  if (limit > 0) airpods = airpods.slice(0, limit)
  log(`AirPods products: ${airpods.length}${limit ? " (limited)" : ""}`)

  let renamed = 0
  const touchedHandles: string[] = []
  for (const p of airpods) {
    const caseOpt = (p.options ?? []).find((o: any) => o.title === "Case Type")
    if (!caseOpt) continue
    const sigVal = (caseOpt.values ?? []).find(
      (v: any) => v.value === PHONE_SIGNATURE_NAME
    )
    if (sigVal) {
      if (!dryRun) {
        await updateProductOptionValuesWorkflow(container).run({
          input: { id: sigVal.id, update: { value: EARBUDS_NAME } },
        })
      }
      renamed++
      touchedHandles.push(p.handle)
    }
    // Uploaded designs persist metadata.case_type_slugs; keep it in sync.
    const meta = (p.metadata ?? {}) as Record<string, any>
    if (
      Array.isArray(meta.case_type_slugs) &&
      meta.case_type_slugs.includes(PHONE_SIGNATURE_SLUG)
    ) {
      const next = [
        ...new Set(
          meta.case_type_slugs.map((s: string) =>
            s === PHONE_SIGNATURE_SLUG ? EARBUDS_SLUG : s
          )
        ),
      ]
      if (!dryRun) {
        await productModule.updateProducts(p.id, {
          metadata: { ...meta, case_type_slugs: next },
        })
      }
      if (!touchedHandles.includes(p.handle)) touchedHandles.push(p.handle)
    }
  }
  log(`renamed the Case Type value on ${renamed} products`)

  // --- 5. Relabel the shared AirPods blanks so stock keys on the new name --
  const { data: blanks } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "metadata"],
    pagination: { take: 100000 },
  })
  const blankUpdates: { id: string; metadata: Record<string, any> }[] = []
  for (const b of blanks as any[]) {
    const m = (b.metadata ?? {}) as Record<string, any>
    const dev = deviceBySlug.get(m.device_slug)
    const isAirpods =
      dev?.family === "airpods" || String(b.sku ?? "").startsWith("SIG-APD")
    if (isAirpods && m.case_type_slug === PHONE_SIGNATURE_SLUG) {
      blankUpdates.push({
        id: b.id,
        metadata: { ...m, case_type_slug: EARBUDS_SLUG, case_type_name: EARBUDS_NAME },
      })
    }
  }
  log(`relabeling ${blankUpdates.length} AirPods blanks`)
  if (blankUpdates.length && !dryRun) {
    await updateInventoryItemsWorkflow(container).run({
      input: { updates: blankUpdates },
    })
  }

  // --- 6. Reprice the renamed variants to 750 (rebuilds their cards) -------
  if (!dryRun) {
    const result = await repriceCaseType({
      container,
      caseTypeName: EARBUDS_NAME,
      amount: EARBUDS_PRICE,
    })
    log(
      `repriced ${result.variants} variants across ${result.products} products @ ${EARBUDS_PRICE}`
    )
  }

  // --- 7. Refresh the storefront caches -----------------------------------
  if (!dryRun) {
    const ok = await revalidateStorefront({
      tags: [
        "products",
        "catalog",
        "catalog:case-types",
        "catalog:shop-catalog",
        "catalog:shop-cards",
        "stock",
        "content",
      ],
      handles: [...new Set(touchedHandles)],
    })
    log(`storefront revalidation ${ok ? "ok" : "failed"}`)
  }

  log("done")
}
