import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260902132846 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "home_section" drop constraint if exists "home_section_key_unique";`);
    this.addSql(`create table if not exists "home_section" ("id" text not null, "key" text not null, "type" text not null, "title" text null, "subtitle" text null, "eyebrow" text null, "cta_label" text null, "cta_href" text null, "config" jsonb null, "position" integer not null default 0, "is_visible" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "home_section_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_home_section_key_unique" ON "home_section" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_home_section_deleted_at" ON "home_section" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "menu_item" ("id" text not null, "section_id" text not null, "group" text null, "label" text not null, "href" text not null, "badge" text null, "position" integer not null default 0, "is_visible" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "menu_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_menu_item_deleted_at" ON "menu_item" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "menu_section" ("id" text not null, "menu" text not null, "label" text not null, "href" text null, "position" integer not null default 0, "is_visible" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "menu_section_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_menu_section_deleted_at" ON "menu_section" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "home_section" cascade;`);

    this.addSql(`drop table if exists "menu_item" cascade;`);

    this.addSql(`drop table if exists "menu_section" cascade;`);
  }

}
