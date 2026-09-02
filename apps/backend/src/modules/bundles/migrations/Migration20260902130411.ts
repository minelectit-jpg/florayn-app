import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260902130411 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "bundle_settings" ("id" text not null, "heading" text not null default 'GET MORE SAVE MORE', "single_label" text not null default 'STANDARD PRICE', "free_shipping_threshold" integer not null default 3400, "scope" text not null default 'cases', "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "bundle_settings_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_bundle_settings_deleted_at" ON "bundle_settings" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "bundle_tier" ("id" text not null, "quantity" integer not null, "badge" text null, "discount_amount" integer not null, "min_pct" integer not null default 0, "max_pct" integer not null default 0, "is_enabled" boolean not null default true, "sort_order" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "bundle_tier_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_bundle_tier_deleted_at" ON "bundle_tier" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "bundle_settings" cascade;`);

    this.addSql(`drop table if exists "bundle_tier" cascade;`);
  }

}
