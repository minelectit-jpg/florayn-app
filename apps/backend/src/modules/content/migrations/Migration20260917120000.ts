import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260917120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "feature_block" ("id" text not null, "title" text null, "description" text null, "image_url" text null, "video_url" text null, "position" integer not null default 0, "is_visible" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "feature_block_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_feature_block_deleted_at" ON "feature_block" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "featured_pick" ("id" text not null, "handle" text not null, "position" integer not null default 0, "is_visible" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "featured_pick_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_featured_pick_deleted_at" ON "featured_pick" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "feature_block" cascade;`);
    this.addSql(`drop table if exists "featured_pick" cascade;`);
  }

}
