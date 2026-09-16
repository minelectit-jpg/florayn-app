import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260916150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "case_type" add column if not exists "image_url" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "case_type" drop column if exists "image_url";`);
  }

}
