import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260902170738 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "collection_page" drop constraint if exists "collection_page_collection_slug_unique";`);
    this.addSql(`create table if not exists "collection_page" ("id" text not null, "collection_slug" text not null, "hero_image_url" text null, "hero_eyebrow" text null, "hero_heading" text null, "cta_label" text null, "cta_href" text null, "intro_heading" text null, "intro_copy" text null, "design_slugs" jsonb null, "is_visible" boolean not null default true, "position" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "collection_page_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_collection_page_collection_slug_unique" ON "collection_page" ("collection_slug") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collection_page_deleted_at" ON "collection_page" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "collection_page" cascade;`);
  }

}
