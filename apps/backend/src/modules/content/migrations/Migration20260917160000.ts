import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260917160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS "feature_block" ADD COLUMN IF NOT EXISTS "case_type" text NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS "feature_block" DROP COLUMN IF EXISTS "case_type";`);
  }

}
