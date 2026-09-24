import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Review requests: when an order last changed status (the request waits from
 * there) and when its "How is your Florayn order?" email went out. Additive
 * and idempotent, so it can run ahead of the deploy that reads it.
 */
export class Migration20260925100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_op" add column if not exists "status_changed_at" timestamptz null;`)
    this.addSql(`alter table if exists "order_op" add column if not exists "review_request_sent_at" timestamptz null;`)
    this.addSql(`alter table if exists "order_op" add column if not exists "review_request_note" text null;`)
    this.addSql(`create index if not exists "IDX_order_op_review_request" on "order_op" ("workflow_status", "review_request_sent_at") where deleted_at is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_order_op_review_request";`)
    for (const column of ["status_changed_at", "review_request_sent_at", "review_request_note"]) {
      this.addSql(`alter table if exists "order_op" drop column if exists "${column}";`)
    }
  }
}
