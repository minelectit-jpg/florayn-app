import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Collection page templates: hero layout, theme, mobile hero, hero copy, card
 * image, display title and the blocks below the grid. Purely additive and
 * idempotent, so it is safe on a database where the columns were added by hand
 * ahead of the deploy.
 */
export class Migration20260923120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "collection_page" add column if not exists "title" text null;`)
    this.addSql(`alter table if exists "collection_page" add column if not exists "template" text not null default 'overlay';`)
    this.addSql(`alter table if exists "collection_page" add column if not exists "theme" jsonb null;`)
    this.addSql(`alter table if exists "collection_page" add column if not exists "hero_mobile_image_url" text null;`)
    this.addSql(`alter table if exists "collection_page" add column if not exists "hero_copy" text null;`)
    this.addSql(`alter table if exists "collection_page" add column if not exists "card_image_url" text null;`)
    this.addSql(`alter table if exists "collection_page" add column if not exists "blocks" jsonb null;`)
  }

  override async down(): Promise<void> {
    for (const column of ["title", "template", "theme", "hero_mobile_image_url", "hero_copy", "card_image_url", "blocks"]) {
      this.addSql(`alter table if exists "collection_page" drop column if exists "${column}";`)
    }
  }
}
