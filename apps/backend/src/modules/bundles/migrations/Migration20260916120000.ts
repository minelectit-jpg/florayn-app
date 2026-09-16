import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Adds the "Matching Set" (phone + AirPods bundle) columns to bundle_settings. */
export class Migration20260916120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "bundle_settings" add column if not exists "matching_set_enabled" boolean not null default true;`);
    this.addSql(`alter table "bundle_settings" add column if not exists "matching_set_title" text not null default 'The Matching Set';`);
    this.addSql(`alter table "bundle_settings" add column if not exists "matching_set_subtitle" text not null default 'One design, two pieces';`);
    this.addSql(`alter table "bundle_settings" add column if not exists "matching_set_discount" integer not null default 250;`);
    this.addSql(`alter table "bundle_settings" add column if not exists "matching_set_default_airpods" text not null default 'AirPods Pro 3';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "bundle_settings" drop column if exists "matching_set_enabled";`);
    this.addSql(`alter table "bundle_settings" drop column if exists "matching_set_title";`);
    this.addSql(`alter table "bundle_settings" drop column if exists "matching_set_subtitle";`);
    this.addSql(`alter table "bundle_settings" drop column if exists "matching_set_discount";`);
    this.addSql(`alter table "bundle_settings" drop column if exists "matching_set_default_airpods";`);
  }

}
