import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260920194733 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "checkout_setting" ("id" text not null, "heading" text not null default 'Checkout', "description" text not null default 'Enter your delivery details to place your order.', "delivery_note" text not null default '', "support_phone" text not null default '+8801310007055', "support_label" text not null default 'Need help?', "show_order_note" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "checkout_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_setting_deleted_at" ON "checkout_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "checkout_setting" cascade;`);
  }

}
