import type { Context } from "@medusajs/framework/types"
import type { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import { InjectManager, InjectTransactionManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"

import { planColourRows, type ColourRow, type ColourRowPlan, type ColourSource, type ResolvedColourVariant } from "../../lib/phone-colour-input"
import CaseType from "./models/case-type"
import Design from "./models/design"
import Device from "./models/device"
import PhoneColourGallery from "./models/phone-colour-gallery"

const COLOUR_ROW_FIELDS = ["id", "product_id", "variant_id", "device_slug", "case_type_slug", "colour_slug", "is_main", "images", "source"]

/**
 * One phone colour save of a variant at a time: a second save of the same
 * variant waits here until the first commits or rolls back. The locks are
 * released with the transaction; sorted IDs, so two multi-variant saves never
 * deadlock. A save that waits longer than 30 s fails (and can be retried).
 */
async function lockColourVariants(context: Context<EntityManager>, variantIds: string[]) {
  const manager = context.transactionManager!
  await manager.execute("set local lock_timeout = '30s'")
  for (const id of [...new Set(variantIds)].sort()) {
    await manager.execute("select pg_advisory_xact_lock(hashtext('phone_colour_gallery'), hashtext(?))", [id])
  }
}

class CatalogModuleService extends MedusaService({
  Design,
  CaseType,
  Device,
  PhoneColourGallery,
}) {
  /**
   * One phone colour save (PHONE_COLOURS.md, POST /admin/designs/:slug/colours):
   * lock, read, plan and write in one transaction, so a failure changes
   * nothing and an overlapping save of the same variant waits for this one.
   * Returns the plan and the rows as they were (the compensation input).
   */
  @InjectManager()
  async savePhoneColourRows(
    variants: ResolvedColourVariant[],
    source: ColourSource,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<{ plan: ColourRowPlan; snapshot: ColourRow[] }> {
    return await this.savePhoneColourRows_(variants, source, sharedContext)
  }

  @InjectTransactionManager()
  protected async savePhoneColourRows_(
    variants: ResolvedColourVariant[],
    source: ColourSource,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<{ plan: ColourRowPlan; snapshot: ColourRow[] }> {
    const ids = [...new Set(variants.map((v) => v.variantId))]
    await lockColourVariants(sharedContext, ids)
    const snapshot = (await this.listPhoneColourGalleries({ variant_id: ids }, { select: COLOUR_ROW_FIELDS, take: 10000 }, sharedContext)) as unknown as ColourRow[]
    const plan = planColourRows(snapshot, variants, source)
    // The unique indexes are checked per statement, even in a transaction: old
    // rows go and old main rows are demoted before a new main row appears.
    if (plan.remove.length) await this.deletePhoneColourGalleries(plan.remove, sharedContext)
    if (plan.update.length) await this.updatePhoneColourGalleries(plan.update, sharedContext)
    if (plan.promote.length) await this.updatePhoneColourGalleries(plan.promote, sharedContext)
    if (plan.create.length) await this.createPhoneColourGalleries(plan.create, sharedContext)
    return { plan, snapshot }
  }

  /** Put these variants' rows back exactly as they were (IDs included), atomically and under the same lock. */
  @InjectManager()
  async restorePhoneColourRows(
    variantIds: string[],
    snapshot: ColourRow[],
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<void> {
    await this.restorePhoneColourRows_(variantIds, snapshot, sharedContext)
  }

  @InjectTransactionManager()
  protected async restorePhoneColourRows_(
    variantIds: string[],
    snapshot: ColourRow[],
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<void> {
    const ids = [...new Set(variantIds)]
    await lockColourVariants(sharedContext, ids)
    const now = await this.listPhoneColourGalleries({ variant_id: ids }, { select: ["id"], take: 10000 }, sharedContext)
    if (now.length) await this.deletePhoneColourGalleries(now.map((row) => row.id), sharedContext)
    if (snapshot.length) await this.createPhoneColourGalleries(snapshot.map((row) => ({ ...row, images: row.images ?? null })), sharedContext)
  }
}

export default CatalogModuleService
