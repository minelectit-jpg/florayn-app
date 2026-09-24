import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Review rewards for phone-only customers: the reviewer's mobile, and whether
 * the code went out by email or WhatsApp. Additive and idempotent.
 */
export class Migration20260926090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_review" add column if not exists "phone" text null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "reward_channel" text null;`)
    this.addSql(`create index if not exists "IDX_product_review_phone_reward" on "product_review" ("phone", "reward_issued_at") where deleted_at is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_product_review_phone_reward";`)
    this.addSql(`alter table if exists "product_review" drop column if exists "reward_channel";`)
    this.addSql(`alter table if exists "product_review" drop column if exists "phone";`)
  }
}
