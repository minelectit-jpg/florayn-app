import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * A short badge per device (e.g. New), shown next to the model in the menu and
 * search. Additive and idempotent.
 */
export class Migration20260927091000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "device" add column if not exists "badge" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "device" drop column if exists "badge";`)
  }
}
