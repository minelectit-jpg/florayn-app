import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Women / Men home pages: each home section belongs to one of them. Every
 * existing section is the Women (root) home page. Additive and idempotent, so
 * it is safe to run ahead of the deploy that reads it.
 */
export class Migration20260924120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "home_section" add column if not exists "audience" text not null default 'women';`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "home_section" drop column if exists "audience";`)
  }
}
