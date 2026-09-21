import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260921200000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "courier_settings" add column if not exists "webhook_token" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "courier_settings" drop column if exists "webhook_token";`);
  }

}
