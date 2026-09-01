import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260901162051 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "device" drop constraint if exists "device_slug_unique";`);
    this.addSql(`alter table if exists "design" drop constraint if exists "design_slug_unique";`);
    this.addSql(`alter table if exists "case_type" drop constraint if exists "case_type_slug_unique";`);
    this.addSql(`create table if not exists "case_type" ("id" text not null, "slug" text not null, "name" text not null, "description" text null, "sku_code" text not null, "base_price" integer not null, "sort_order" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "case_type_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_case_type_slug_unique" ON "case_type" ("slug") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_case_type_deleted_at" ON "case_type" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "design" ("id" text not null, "slug" text not null, "name" text not null, "description" text null, "theme" text null, "artist" text null, "hero_image_url" text null, "sku_code" text not null, "sort_order" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_design_slug_unique" ON "design" ("slug") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_deleted_at" ON "design" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "device" ("id" text not null, "slug" text not null, "name" text not null, "family" text check ("family" in ('iphone', 'samsung', 'airpods', 'watch', 'wallet')) not null, "brand" text not null, "sku_code" text not null, "price_delta" integer not null default 0, "sort_order" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "device_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_device_slug_unique" ON "device" ("slug") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_device_deleted_at" ON "device" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "case_type_devices" ("case_type_id" text not null, "device_id" text not null, constraint "case_type_devices_pkey" primary key ("case_type_id", "device_id"));`);

    this.addSql(`alter table if exists "case_type_devices" add constraint "case_type_devices_case_type_id_foreign" foreign key ("case_type_id") references "case_type" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table if exists "case_type_devices" add constraint "case_type_devices_device_id_foreign" foreign key ("device_id") references "device" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "case_type_devices" drop constraint if exists "case_type_devices_case_type_id_foreign";`);

    this.addSql(`alter table if exists "case_type_devices" drop constraint if exists "case_type_devices_device_id_foreign";`);

    this.addSql(`drop table if exists "case_type" cascade;`);

    this.addSql(`drop table if exists "design" cascade;`);

    this.addSql(`drop table if exists "device" cascade;`);

    this.addSql(`drop table if exists "case_type_devices" cascade;`);
  }

}
