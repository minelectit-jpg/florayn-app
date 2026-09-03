import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260903084818 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "seo_override" ("id" text not null, "scope" text not null, "key" text not null, "title" text null, "description" text null, "fit_copy" text null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "seo_override_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_seo_override_deleted_at" ON "seo_override" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "seo_setting" ("id" text not null, "title_template" text not null default '{design} {device} Case - {caseType}', "description_template" text not null default '{design} {device} case in our {caseType} finish. Printed in Dhaka, cash on delivery across Bangladesh.', "heading_template" text not null default '{design} {device} Case', "fit_copy_enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "seo_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_seo_setting_deleted_at" ON "seo_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "seo_override" cascade;`);

    this.addSql(`drop table if exists "seo_setting" cascade;`);
  }

}
