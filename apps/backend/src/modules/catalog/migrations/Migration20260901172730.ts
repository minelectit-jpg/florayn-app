import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260901172730 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "case_type" rename column "base_price" to "price";`);

    this.addSql(`alter table if exists "device" drop column if exists "price_delta";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "case_type" rename column "price" to "base_price";`);

    this.addSql(`alter table if exists "device" add column if not exists "price_delta" integer not null default 0;`);
  }

}
