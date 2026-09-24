import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The florayn.com order import: which WooCommerce order became which Medusa
 * order, the import's key and progress, and a source mark on the order's
 * workflow row. Additive and idempotent.
 */
export class Migration20260926093000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "imported_order" ("id" text not null, "source" text not null, "source_id" text not null, "order_id" text not null, "source_status" text null, "source_modified_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "imported_order_pkey" primary key ("id"));`)
    this.addSql(`create unique index if not exists "IDX_imported_order_source_source_id_unique" on "imported_order" ("source", "source_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_imported_order_order_id" on "imported_order" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_imported_order_deleted_at" on "imported_order" ("deleted_at") where deleted_at is null;`)

    this.addSql(`create table if not exists "order_import" ("id" text not null, "site_url" text not null default 'https://florayn.com', "consumer_key" text null, "consumer_secret" text null, "state" text not null default 'idle', "progress" jsonb null, "started_at" timestamptz null, "finished_at" timestamptz null, "last_error" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_import_pkey" primary key ("id"));`)
    this.addSql(`create index if not exists "IDX_order_import_deleted_at" on "order_import" ("deleted_at") where deleted_at is null;`)

    this.addSql(`alter table if exists "order_op" add column if not exists "source" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "order_op" drop column if exists "source";`)
    this.addSql(`drop table if exists "order_import" cascade;`)
    this.addSql(`drop table if exists "imported_order" cascade;`)
  }
}
