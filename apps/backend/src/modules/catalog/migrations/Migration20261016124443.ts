import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Phone colour pictures (PHONE_COLOURS.md): one row per (variant, phone colour).
 * Additive: only the new table and its indexes, no data migration.
 */
export class Migration20261016124443 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "phone_colour_gallery" drop constraint if exists "phone_colour_gallery_variant_id_colour_slug_unique";`);
    this.addSql(`create table if not exists "phone_colour_gallery" ("id" text not null, "product_id" text not null, "variant_id" text not null, "device_slug" text not null, "case_type_slug" text not null, "colour_slug" text not null, "is_main" boolean not null default false, "images" text[] null, "source" text check ("source" in ('mockup_studio', 'manual')) not null default 'manual', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "phone_colour_gallery_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_phone_colour_gallery_deleted_at" ON "phone_colour_gallery" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_phone_colour_gallery_variant_id_colour_slug_unique" ON "phone_colour_gallery" ("variant_id", "colour_slug") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_phone_colour_gallery_one_main" ON "phone_colour_gallery" ("variant_id") WHERE is_main = true AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_phone_colour_gallery_product_id" ON "phone_colour_gallery" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_phone_colour_gallery_device_slug_case_type_slug_colour_slug" ON "phone_colour_gallery" ("device_slug", "case_type_slug", "colour_slug") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "phone_colour_gallery" cascade;`);
  }

}
