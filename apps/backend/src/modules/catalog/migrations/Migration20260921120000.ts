import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260921120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "case_type" add column if not exists "price_groups" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "case_type" drop column if exists "price_groups";`);
  }

}
