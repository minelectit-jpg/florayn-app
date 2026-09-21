import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260921210000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_op" add column if not exists "courier_meta" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "order_op" drop column if exists "courier_meta";`);
  }

}
