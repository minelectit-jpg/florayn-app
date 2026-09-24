import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Review photos, the reviewer's email and order (verified purchase) and the
 * discount code a review earned. Additive and idempotent.
 */
export class Migration20260925100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_review" add column if not exists "images" jsonb null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "email" text null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "order_id" text null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "verified" boolean not null default false;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "coupon_code" text null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "reward_pct" integer null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "reward_issued_at" timestamptz null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "reward_mailed_at" timestamptz null;`)
    this.addSql(`alter table if exists "product_review" add column if not exists "reward_note" text null;`)
    this.addSql(`create index if not exists "IDX_product_review_email_reward" on "product_review" ("email", "reward_issued_at") where deleted_at is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_product_review_email_reward";`)
    for (const column of ["images", "email", "order_id", "verified", "coupon_code", "reward_pct", "reward_issued_at", "reward_mailed_at", "reward_note"]) {
      this.addSql(`alter table if exists "product_review" drop column if exists "${column}";`)
    }
  }
}
