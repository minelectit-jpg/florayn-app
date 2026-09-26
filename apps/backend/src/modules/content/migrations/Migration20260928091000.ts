import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The Privacy page singleton (`privacyset_default`): a title, a plain-text
 * body and a published switch. It starts unpublished with no text, so the
 * storefront keeps its placeholder until Florayn publishes approved wording.
 * Hand-written like the tracking migration because Admin > Tracking reads
 * `privacy_setting.published` with knex. Additive and idempotent: only this
 * table and its index, applied with scripts/migrate-privacy-settings.ts.
 */
export class Migration20260928091000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "privacy_setting" ("id" text not null, "title" text not null default 'Privacy policy', "body" text not null default '', "published" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "privacy_setting_pkey" primary key ("id"));`)
    this.addSql(`create index if not exists "IDX_privacy_setting_deleted_at" on "privacy_setting" ("deleted_at") where deleted_at is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "privacy_setting" cascade;`)
  }
}
