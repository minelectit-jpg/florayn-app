import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Header v2: typed menu sections (links, or filled automatically from
 * Devices, Case types or Collection pages) with a picture, a badge and where
 * they show, and "Show in menu" on collection pages. Every existing section
 * stays a links section shown everywhere, so the old menu renders unchanged.
 * Additive and idempotent.
 */
export class Migration20260927090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "menu_section" add column if not exists "kind" text not null default 'links';`)
    this.addSql(`alter table if exists "menu_section" add column if not exists "image_url" text null;`)
    this.addSql(`alter table if exists "menu_section" add column if not exists "badge" text null;`)
    this.addSql(`alter table if exists "menu_section" add column if not exists "placement" text not null default 'all';`)
    this.addSql(`alter table if exists "menu_section" add column if not exists "config" jsonb null;`)
    this.addSql(`alter table if exists "collection_page" add column if not exists "show_in_menu" boolean not null default true;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "collection_page" drop column if exists "show_in_menu";`)
    for (const column of ["kind", "image_url", "badge", "placement", "config"]) {
      this.addSql(`alter table if exists "menu_section" drop column if exists "${column}";`)
    }
  }
}
