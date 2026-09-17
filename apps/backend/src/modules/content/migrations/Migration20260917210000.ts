import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260917210000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS "gallery_video" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 1;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS "gallery_video" DROP COLUMN IF EXISTS "position";`);
  }

}
