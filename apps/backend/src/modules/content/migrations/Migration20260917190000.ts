import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260917190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "gallery_video" ("id" text not null, "design_slug" text not null, "case_type" text not null, "video_url" text not null, "poster_url" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "gallery_video_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_gallery_video_deleted_at" ON "gallery_video" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_gallery_video_design_slug" ON "gallery_video" ("design_slug") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "gallery_video" cascade;`);
  }

}
